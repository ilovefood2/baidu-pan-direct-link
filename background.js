const DOWNLOAD_MESSAGE = "PANLINK_START_DOWNLOAD";
const DOWNLOAD_STATUS_MESSAGE = "PANLINK_DOWNLOAD_STATUS";
const activeDownloads = new Map();

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanel();
});

configureSidePanel();

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("无法设置侧边栏行为：", error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== DOWNLOAD_MESSAGE) {
    return false;
  }

  startDownload(message)
    .then((downloadId) => sendResponse({ ok: true, downloadId }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  handleDownloadChange(delta).catch((error) => {
    console.warn("无法读取下载状态：", error);
  });
});

async function startDownload(message) {
  const url = validateDownloadUrl(message.url);
  const filename = sanitizeFilename(message.filename);
  const options = {
    url,
    saveAs: true,
    conflictAction: "uniquify"
  };

  if (filename) {
    options.filename = filename;
  }

  const downloadId = await chrome.downloads.download(options);
  activeDownloads.set(downloadId, { filename: filename || "文件" });
  return downloadId;
}

async function handleDownloadChange(delta) {
  let task = activeDownloads.get(delta.id);
  const isTerminal =
    Boolean(delta.error?.current) ||
    delta.state?.current === "complete" ||
    delta.state?.current === "interrupted";

  if (!task && isTerminal) {
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (isBaiduDownload(item?.url)) {
      task = {
        filename: downloadBasename(item?.filename) || "文件"
      };
    }
  }

  if (!task) {
    return;
  }

  if (delta.error?.current) {
    notifyDownloadStatus({
      downloadId: delta.id,
      filename: task.filename,
      status: "error",
      error: describeDownloadError(delta.error.current)
    });
    activeDownloads.delete(delta.id);
    return;
  }

  if (delta.state?.current === "complete") {
    notifyDownloadStatus({
      downloadId: delta.id,
      filename: task.filename,
      status: "complete"
    });
    activeDownloads.delete(delta.id);
    return;
  }

  if (delta.state?.current === "interrupted") {
    const [item] = await chrome.downloads.search({ id: delta.id });
    notifyDownloadStatus({
      downloadId: delta.id,
      filename: task.filename,
      status: "error",
      error: describeDownloadError(item?.error || "SERVER_FAILED")
    });
    activeDownloads.delete(delta.id);
  }
}

function isBaiduDownload(value) {
  try {
    return new URL(value).hostname === "d.pcs.baidu.com";
  } catch {
    return false;
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

function validateDownloadUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("下载地址无效");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("仅支持 HTTP 或 HTTPS 下载地址");
  }

  return url.href;
}

function sanitizeFilename(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
}
