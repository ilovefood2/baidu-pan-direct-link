const DOWNLOAD_STATUS_MESSAGE = "PANLINK_DOWNLOAD_STATUS";
const START_DOWNLOAD_MESSAGE = "PANLINK_START_DOWNLOAD";
const RESOLVE_ARIA2_MESSAGE = "PANLINK_RESOLVE_ARIA2";
const DOWNLOAD_TASK_PREFIX = "panlinkDownload:";

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});

configureSidePanel();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;
  if (message?.type === START_DOWNLOAD_MESSAGE) {
    operation = startAuthenticatedDownload(
      message.path,
      message.filename,
      message.expectedSize
    );
  } else if (message?.type === RESOLVE_ARIA2_MESSAGE) {
    operation = resolveAria2Url(message.path);
  } else {
    return false;
  }

  operation
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("无法设置侧边栏行为：", error);
  }
}

async function startAuthenticatedDownload(
  pathValue,
  filenameValue,
  expectedSizeValue
) {
  const path = normalizeDownloadPath(pathValue);
  const filename =
    sanitizeFilename(filenameValue) ||
    sanitizeFilename(path.split("/").pop()) ||
    "百度网盘文件";
  const expectedSize = normalizeExpectedSize(expectedSizeValue);
  const downloadId = await chrome.downloads.download({
    url: buildPcsDownloadUrl(path),
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  if (!Number.isInteger(downloadId)) {
    throw new Error("Chrome 未能创建下载任务");
  }

  await chrome.storage.session.set({
    [downloadTaskKey(downloadId)]: {
      filename,
      expectedSize
    }
  });

  return { downloadId };
}

function normalizeExpectedSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

function downloadTaskKey(downloadId) {
  return `${DOWNLOAD_TASK_PREFIX}${downloadId}`;
}

function normalizeDownloadPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/") || path === "/") {
    throw new Error("文件路径无效，请重新解析");
  }

  const segments = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  if (!segments.length) {
    throw new Error("文件路径无效，请重新解析");
  }
  return `/${segments.join("/")}`;
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
}

function buildPcsDownloadUrl(path) {
  const params = new URLSearchParams({
    method: "download",
    app_id: "778750",
    path,
    ver: "2.0",
    clienttype: "1"
  });
  return `https://c.pcs.baidu.com/rest/2.0/pcs/file?${params.toString()}`;
}

async function resolveAria2Url(pathValue) {
  const path = normalizeDownloadPath(pathValue);
  let response;
  try {
    response = await fetch(buildPcsDownloadUrl(path), {
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
  } catch {
    throw new Error("无法连接百度服务器生成 aria2c 地址");
  }

  if (!response.ok) {
    throw new Error(await describePcsResponseError(response));
  }

  const finalUrl = response.url;
  if (!isAllowedBaiduCdnUrl(finalUrl)) {
    await cancelResponseBody(response);
    throw new Error("百度没有返回可供 aria2c 使用的临时 CDN 地址");
  }

  await cancelResponseBody(response);
  return { url: finalUrl };
}

async function describePcsResponseError(response) {
  let detail = "";
  try {
    const text = await response.text();
    const payload = JSON.parse(text);
    detail = payload.error_msg || payload.errmsg || payload.message || "";
  } catch {
    await cancelResponseBody(response);
  }

  return detail
    ? `百度拒绝生成 aria2c 地址：${detail}`
    : `百度拒绝生成 aria2c 地址（HTTP ${response.status}）`;
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response may already be closed after a short ranged request.
  }
}

function isAllowedBaiduCdnUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (hostname === "d.pcs.baidu.com" ||
        hostname === "baidupcs.com" ||
        hostname.endsWith(".baidupcs.com"))
    );
  } catch {
    return false;
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  handleDownloadChange(delta).catch((error) => {
    console.warn("无法读取下载状态：", error);
  });
});

async function handleDownloadChange(delta) {
  const isTerminal =
    Boolean(delta.error?.current) ||
    delta.state?.current === "complete" ||
    delta.state?.current === "interrupted";

  if (!isTerminal) {
    return;
  }

  const taskKey = downloadTaskKey(delta.id);
  const stored = await chrome.storage.session.get(taskKey);
  const task = stored[taskKey];
  if (!task) {
    return;
  }
  await chrome.storage.session.remove(taskKey);
  const [item] = await chrome.downloads.search({ id: delta.id });
  const filename =
    downloadBasename(item?.filename) || task.filename || "文件";

  if (delta.error?.current) {
    notifyDownloadStatus({
      downloadId: delta.id,
      filename,
      status: "error",
      error: describeDownloadError(delta.error.current)
    });
    return;
  }

  if (delta.state?.current === "complete") {
    if (
      task.expectedSize > 0 &&
      Number.isFinite(item?.totalBytes) &&
      item.totalBytes >= 0 &&
      item.totalBytes !== task.expectedSize
    ) {
      notifyDownloadStatus({
        downloadId: delta.id,
        filename,
        status: "error",
        error: "百度返回的文件大小不符，可能是错误信息而不是原文件"
      });
      return;
    }

    notifyDownloadStatus({
      downloadId: delta.id,
      filename,
      status: "complete"
    });
    return;
  }

  if (delta.state?.current === "interrupted") {
    const [item] = await chrome.downloads.search({ id: delta.id });
    notifyDownloadStatus({
      downloadId: delta.id,
      filename,
      status: "error",
      error: describeDownloadError(item?.error || "SERVER_FAILED")
    });
  }
}

function downloadBasename(value) {
  return String(value || "").split(/[\\/]/).pop();
}

function notifyDownloadStatus(payload) {
  chrome.runtime
    .sendMessage({
      type: DOWNLOAD_STATUS_MESSAGE,
      ...payload
    })
    .catch(() => {
      // The side panel may have been closed while the download was running.
    });
}

function describeDownloadError(reason) {
  const messages = {
    SERVER_BAD_CONTENT: "百度服务器返回了无效内容，请重新解析直链",
    SERVER_UNAUTHORIZED: "百度拒绝了下载请求，请重新登录后再解析",
    SERVER_FORBIDDEN: "百度拒绝了下载请求，请重新解析直链",
    SERVER_UNREACHABLE: "无法连接百度下载服务器",
    SERVER_CONTENT_LENGTH_MISMATCH: "下载内容不完整，请重新解析后重试",
    NETWORK_FAILED: "网络连接失败",
    NETWORK_TIMEOUT: "连接百度下载服务器超时",
    NETWORK_DISCONNECTED: "网络连接已断开",
    NETWORK_SERVER_DOWN: "百度下载服务器暂时不可用",
    NETWORK_INVALID_REQUEST: "下载请求无效，请重新解析直链",
    FILE_ACCESS_DENIED: "Chrome 无法写入所选位置",
    FILE_NO_SPACE: "磁盘空间不足",
    FILE_NAME_TOO_LONG: "文件名过长",
    FILE_TOO_LARGE: "文件过大，当前文件系统无法保存",
    FILE_BLOCKED: "文件被 Chrome 的安全策略拦截",
    FILE_SECURITY_CHECK_FAILED: "Chrome 文件安全检查失败",
    USER_CANCELED: "下载已取消",
    USER_SHUTDOWN: "浏览器关闭，下载已停止"
  };

  return messages[reason] || `下载中断（${reason}）`;
}
