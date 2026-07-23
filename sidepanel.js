const CONTENT_SCRIPT_FILE = "content.js";
const BAIDU_DOWNLOAD_USER_AGENT =
  "netdisk;2.2.51.6;netdisk;10.0.63;PC;PC-Windows;6.2.9200;WindowsBaiduYunGuanJia";

const state = {
  tabId: null,
  currentPath: "/",
  files: [],
  selectedPaths: new Set(),
  results: new Map(),
  loading: false,
  filter: ""
};

const elements = {
  connectionBadge: document.querySelector("#connectionBadge"),
  unsupportedCard: document.querySelector("#unsupportedCard"),
  workspace: document.querySelector("#workspace"),
  retryButton: document.querySelector("#retryButton"),
  upButton: document.querySelector("#upButton"),
  refreshButton: document.querySelector("#refreshButton"),
  pathText: document.querySelector("#pathText"),
  searchInput: document.querySelector("#searchInput"),
  selectAllButton: document.querySelector("#selectAllButton"),
  fileCount: document.querySelector("#fileCount"),
  selectedCount: document.querySelector("#selectedCount"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  fileList: document.querySelector("#fileList"),
  actionTitle: document.querySelector("#actionTitle"),
  generateButton: document.querySelector("#generateButton"),
  resultsSection: document.querySelector("#resultsSection"),
  resultCount: document.querySelector("#resultCount"),
  resultList: document.querySelector("#resultList"),
  copyAllButton: document.querySelector("#copyAllButton"),
  clearResultsButton: document.querySelector("#clearResultsButton"),
  toast: document.querySelector("#toast")
};

let toastTimer;
let tabRefreshTimer;

elements.retryButton.addEventListener("click", connect);
elements.refreshButton.addEventListener("click", () => loadDirectory(state.currentPath));
elements.upButton.addEventListener("click", () => loadDirectory(parentPath(state.currentPath)));
elements.searchInput.addEventListener("input", (event) => {
  state.filter = event.target.value.trim().toLocaleLowerCase();
  renderFiles();
});
elements.selectAllButton.addEventListener("click", toggleSelectAll);
elements.generateButton.addEventListener("click", generateSelectedLinks);
elements.copyAllButton.addEventListener("click", copyAllLinks);
elements.clearResultsButton.addEventListener("click", () => {
  state.results.clear();
  renderResults();
});

chrome.tabs.onActivated.addListener(() => scheduleReconnect());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
    scheduleReconnect();
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "PANLINK_DOWNLOAD_STATUS") {
    return;
  }

  if (message.status === "complete") {
    showToast(`下载完成：${message.filename}`);
  } else if (message.status === "error") {
    showToast(`下载失败：${message.error}`, true);
  }
});

connect();

function scheduleReconnect() {
  clearTimeout(tabRefreshTimer);
  tabRefreshTimer = setTimeout(connect, 250);
}

async function connect() {
  setConnection("正在连接", "neutral");
  setUnsupported(false);

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });

    if (!tab?.id || !isSupportedUrl(tab.url)) {
      throw new Error("请先打开百度网盘文件页面");
    }

    state.tabId = tab.id;
    const context = await sendToContent({ type: "PANLINK_GET_CONTEXT" });
    setConnection("已连接", "success");
    elements.workspace.hidden = false;
    elements.unsupportedCard.hidden = true;
    await loadDirectory(context.path || "/");
  } catch (error) {
    state.tabId = null;
    setConnection("未连接", "error");
    setUnsupported(true, error.message);
  }
}

function isSupportedUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "pan.baidu.com" &&
      url.pathname.startsWith("/disk/main")
    );
  } catch {
    return false;
  }
}

async function sendToContent(message) {
  if (!state.tabId) {
    throw new Error("没有可用的百度网盘标签页");
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(state.tabId, message);
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      files: [CONTENT_SCRIPT_FILE]
    });
    response = await chrome.tabs.sendMessage(state.tabId, message);
  }

  if (!response?.ok) {
    throw new Error(response?.error || "百度网盘页面没有响应");
  }

  return response.data;
}

async function loadDirectory(path) {
  if (state.loading) {
    return;
  }

  state.loading = true;
  state.currentPath = normalizePath(path);
  state.selectedPaths.clear();
  elements.searchInput.value = "";
  state.filter = "";
  renderLoading(true);
  updateSelectionUi();

  try {
    const payload = await sendToContent({
      type: "PANLINK_LIST_DIR",
      path: state.currentPath
    });
    state.currentPath = payload.path;
    state.files = payload.files;
    if (payload.truncated) {
      showToast("目录项目过多，仅显示前 50,000 项");
    }
    renderFiles();
  } catch (error) {
    state.files = [];
    renderFiles();
    showToast(error.message, true);
  } finally {
    state.loading = false;
    renderLoading(false);
  }
}

function renderLoading(isLoading) {
  elements.loadingState.hidden = !isLoading;
  elements.fileList.hidden = isLoading;
  elements.emptyState.hidden = true;
  elements.refreshButton.disabled = isLoading;
  elements.upButton.disabled = isLoading || state.currentPath === "/";
}

function renderFiles() {
  elements.fileList.replaceChildren();
  elements.pathText.textContent = state.currentPath;
  elements.pathText.title = state.currentPath;
  elements.upButton.disabled = state.loading || state.currentPath === "/";

  const visibleFiles = state.files.filter((file) => {
    if (!state.filter) {
      return true;
    }
    return (
      file.name.toLocaleLowerCase().includes(state.filter) ||
      file.path.toLocaleLowerCase().includes(state.filter)
    );
  });

  elements.fileCount.textContent = String(visibleFiles.length);
  elements.emptyState.hidden = state.loading || visibleFiles.length > 0;
  elements.fileList.hidden = state.loading || visibleFiles.length === 0;

  const fragment = document.createDocumentFragment();
  for (const file of visibleFiles) {
    fragment.append(createFileRow(file));
  }
  elements.fileList.append(fragment);
  updateSelectionUi();
}

function createFileRow(file) {
  const row = document.createElement("div");
  row.className = "file-row";

  if (file.isDirectory) {
    const placeholder = document.createElement("span");
    placeholder.className = "file-check-placeholder";
    row.append(placeholder);
  } else {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "file-check";
    checkbox.checked = state.selectedPaths.has(file.path);
    checkbox.setAttribute("aria-label", `选择 ${file.name}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedPaths.add(file.path);
      } else {
        state.selectedPaths.delete(file.path);
      }
      updateSelectionUi();
    });
    row.append(checkbox);
  }

  const icon = document.createElement("span");
  icon.className = `file-icon${file.isDirectory ? " folder" : ""}`;
  icon.textContent = file.isDirectory ? "▰" : fileExtension(file.name);
  icon.setAttribute("aria-hidden", "true");
  row.append(icon);

  const info = document.createElement("div");
  info.className = "file-info";

  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = file.name;
  name.title = file.name;
  info.append(name);

  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = file.isDirectory
    ? formatModified(file.modifiedAt)
    : `${formatBytes(file.size)} · ${formatModified(file.modifiedAt)}`;
  info.append(meta);
  row.append(info);

  const action = document.createElement("button");
  action.className = "row-button";
  action.type = "button";

  if (file.isDirectory) {
    action.textContent = "进入";
    action.addEventListener("click", () => loadDirectory(file.path));
    row.addEventListener("dblclick", () => loadDirectory(file.path));
  } else {
    action.textContent = "解析";
    action.addEventListener("click", () => generateLinks([file]));
  }

  row.append(action);
  return row;
}

function updateSelectionUi() {
  const selectedCount = state.selectedPaths.size;
  elements.selectedCount.textContent = `已选 ${selectedCount}`;
  elements.generateButton.disabled = selectedCount === 0 || state.loading;
  elements.actionTitle.textContent =
    selectedCount === 0
      ? "选择需要解析的文件"
      : `准备解析 ${selectedCount} 个文件`;

  const visibleSelectable = getVisibleFiles().filter((file) => !file.isDirectory);
  const allVisibleSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((file) => state.selectedPaths.has(file.path));
  elements.selectAllButton.textContent = allVisibleSelected ? "取消全选" : "全选文件";
}

function getVisibleFiles() {
  return state.files.filter((file) => {
    if (!state.filter) {
      return true;
    }
    return (
      file.name.toLocaleLowerCase().includes(state.filter) ||
      file.path.toLocaleLowerCase().includes(state.filter)
    );
  });
}

function toggleSelectAll() {
  const visibleFiles = getVisibleFiles().filter((file) => !file.isDirectory);
  const allSelected =
    visibleFiles.length > 0 &&
    visibleFiles.every((file) => state.selectedPaths.has(file.path));

  for (const file of visibleFiles) {
    if (allSelected) {
      state.selectedPaths.delete(file.path);
    } else {
      state.selectedPaths.add(file.path);
    }
  }

  renderFiles();
}

async function generateSelectedLinks() {
  const selectedFiles = state.files.filter(
    (file) => !file.isDirectory && state.selectedPaths.has(file.path)
  );
  await generateLinks(selectedFiles);
}

async function generateLinks(files) {
  if (!files.length || state.loading) {
    return;
  }

  const originalText = elements.generateButton.textContent;
  state.loading = true;
  elements.generateButton.disabled = true;
  elements.generateButton.textContent = "解析中…";

  try {
    const payload = await sendToContent({
      type: "PANLINK_GET_DLINKS",
      files
    });

    for (const result of payload.files) {
      state.results.set(result.path, {
        ...result,
        generatedAt: payload.generatedAt
      });
    }

    renderResults();
    const successCount = payload.files.filter((item) => item.dlink).length;
    showToast(`已生成 ${successCount} 条直链`);
    elements.resultsSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.loading = false;
    elements.generateButton.textContent = originalText;
    updateSelectionUi();
  }
}

function renderResults() {
  const results = [...state.results.values()];
  elements.resultList.replaceChildren();
  elements.resultCount.textContent = String(
    results.filter((result) => result.dlink).length
  );
  elements.resultsSection.hidden = results.length === 0;

  const fragment = document.createDocumentFragment();
  for (const result of results) {
    fragment.append(createResultItem(result));
  }
  elements.resultList.append(fragment);
}

function createResultItem(result) {
  const item = document.createElement("article");
  item.className = `result-item${result.error ? " has-error" : ""}`;

  const name = document.createElement("div");
  name.className = "result-name";
  name.textContent = result.name;
  name.title = result.path;
  item.append(name);

  if (result.error || !result.dlink) {
    const error = document.createElement("p");
    error.className = "result-error";
    error.textContent = result.error || "没有取得直链";
    item.append(error);
    return item;
  }

  const url = document.createElement("code");
  url.className = "result-url";
  url.textContent = result.dlink;
  url.title = result.dlink;
  item.append(url);

  const buttons = document.createElement("div");
  buttons.className = "result-buttons";
  buttons.append(
    resultButton("复制直链", () => copyText(result.dlink, "直链已复制")),
    resultButton("浏览器下载", () => startBrowserDownload(result)),
    resultButton("复制 aria2", () =>
      copyText(buildAria2Command(result), "aria2 命令已复制")
    )
  );
  item.append(buttons);
  return item;
}

function resultButton(label, handler) {
  const button = document.createElement("button");
  button.className = "button button-quiet";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function copyAllLinks() {
  const validResults = [...state.results.values()].filter((result) => result.dlink);
  if (!validResults.length) {
    showToast("没有可复制的直链", true);
    return;
  }

  const text = validResults
    .map((result) => `${result.name}\n${result.dlink}`)
    .join("\n\n");
  await copyText(text, `已复制 ${validResults.length} 条直链`);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    showToast(copied ? successMessage : "复制失败，请手动选择", !copied);
  }
}

async function startBrowserDownload(result) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "PANLINK_START_DOWNLOAD",
      url: result.dlink,
      filename: result.name
    });
  } catch (error) {
    showToast(error.message || "无法连接扩展后台", true);
    return;
  }

  if (!response?.ok) {
    showToast(response?.error || "无法开始下载", true);
    return;
  }

  showToast("下载已开始");
}

function buildAria2Command(result) {
  return [
    "aria2c",
    "-c",
    "-s16",
    "-x16",
    `--user-agent="${BAIDU_DOWNLOAD_USER_AGENT}"`,
    '--referer="https://pan.baidu.com/disk/home"',
    `--out=${shellQuote(result.name)}`,
    shellQuote(result.dlink)
  ].join(" ");
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function setUnsupported(unsupported, message) {
  elements.unsupportedCard.hidden = !unsupported;
  elements.workspace.hidden = unsupported;
  if (unsupported && message) {
    const paragraph = elements.unsupportedCard.querySelector("p");
    paragraph.textContent = message;
  }
}

function setConnection(text, type) {
  elements.connectionBadge.textContent = text;
  elements.connectionBadge.className = `badge badge-${type}`;
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? "#a52e3a" : "#1d2638";
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 2600);
}

function normalizePath(value) {
  let path = String(value || "/").trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  path = path.replace(/\/{2,}/g, "/");
  return path === "/" ? "/" : path.replace(/\/$/g, "");
}

function parentPath(value) {
  const path = normalizePath(value);
  if (path === "/") {
    return "/";
  }
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function fileExtension(name) {
  const match = String(name).match(/\.([^.]{1,4})$/);
  return match ? match[1].slice(0, 3).toUpperCase() : "FILE";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatModified(timestamp) {
  if (!timestamp) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}
