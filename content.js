(() => {
  if (globalThis.__PANLINK_CONTENT_SCRIPT__) {
    return;
  }
  globalThis.__PANLINK_CONTENT_SCRIPT__ = true;

  const MESSAGE_PREFIX = "PANLINK_";
  const MAX_PAGES = 50;
  const PAGE_SIZE = 1000;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type?.startsWith(MESSAGE_PREFIX)) {
      return false;
    }

    handleMessage(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });

  async function handleMessage(message) {
    assertSupportedPage();

    switch (message.type) {
      case "PANLINK_GET_CONTEXT":
        return {
          url: location.href,
          path: getCurrentPath(),
          title: document.title
        };

      case "PANLINK_LIST_DIR":
        return listDirectory(normalizePath(message.path || getCurrentPath()));

      case "PANLINK_GET_DLINKS":
        return getDownloadLinks(message.files);

      default:
        throw new Error("不支持的扩展操作");
    }
  }

  function assertSupportedPage() {
    if (
      location.hostname !== "pan.baidu.com" ||
      !location.pathname.startsWith("/disk/main")
    ) {
      throw new Error("请先打开百度网盘文件页面");
    }
  }

  function getCurrentPath() {
    const hash = location.hash.startsWith("#")
      ? location.hash.slice(1)
      : location.hash;
    const questionMark = hash.indexOf("?");
    if (questionMark === -1) {
      return "/";
    }

    const params = new URLSearchParams(hash.slice(questionMark + 1));
    return normalizePath(params.get("path") || "/");
  }

  function normalizePath(value) {
    let path = String(value || "/").trim();
    if (!path.startsWith("/")) {
      path = `/${path}`;
    }
    path = path.replace(/\/{2,}/g, "/");

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

    return `/${segments.join("/")}`;
  }

  async function listDirectory(path) {
    const collected = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        order: "name",
        desc: "0",
        showempty: "0",
        web: "1",
        page: String(page),
        num: String(PAGE_SIZE),
        dir: path,
        channel: "chunlei",
        app_id: "250528",
        clienttype: "0"
      });

      const payload = await panFetch(`/api/list?${params.toString()}`);
      const pageFiles = Array.isArray(payload.list) ? payload.list : [];
      collected.push(...pageFiles.map(normalizeFile));

      if (pageFiles.length < PAGE_SIZE) {
        return {
          path,
          files: collected,
          truncated: false
        };
      }
    }

    return {
      path,
      files: collected,
      truncated: true
    };
  }

  function normalizeFile(file) {
    return {
      fsId: String(file.fs_id ?? ""),
      name: String(file.server_filename ?? file.path?.split("/").pop() ?? ""),
      path: normalizePath(file.path || "/"),
      size: Number(file.size || 0),
      isDirectory: Number(file.isdir) === 1,
      modifiedAt: Number(file.server_mtime || file.local_mtime || 0) * 1000
    };
  }

  async function getDownloadLinks(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("请先选择至少一个文件");
    }

    const normalized = files.map((file) => {
      const path = normalizePath(file?.path);
      if (file?.isDirectory) {
        throw new Error(`“${file.name || path}”是文件夹，不能直接解析`);
      }
      const fsId = String(file?.fsId ?? "");
      return {
        fsId: /^\d+$/.test(fsId) ? fsId : "",
        name: String(file?.name || path.split("/").pop() || "未命名文件"),
        path,
        size: Number(file?.size || 0)
      };
    });

    const results = normalized.map((file) => ({
      ...file,
      dlink: buildPcsDownloadUrl(file.path),
      error: ""
    }));

    return {
      generatedAt: Date.now(),
      files: results
    };
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

  async function panFetch(path, options = {}) {
    const url = new URL(path, location.origin);
    const response = await fetch(url.href, {
      ...options,
      credentials: "include",
      cache: "no-store"
    });
    const text = await response.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      if (/登录|login/i.test(text)) {
        throw new Error("登录状态已失效，请重新登录百度网盘");
      }
      throw new Error(`百度接口返回了无法识别的内容（HTTP ${response.status}）`);
    }

    if (!response.ok) {
      throw new Error(`百度接口请求失败（HTTP ${response.status}）`);
    }

    const errno = Number(payload.errno ?? 0);
    if (errno !== 0) {
      throw new Error(getApiErrorMessage(errno, payload));
    }

    return payload;
  }

  function getApiErrorMessage(errno, payload) {
    const knownErrors = {
      "-6": "登录状态已失效，请重新登录百度网盘",
      "-7": "当前账号没有访问该文件的权限",
      "-9": "文件或目录不存在",
      "2": "百度接口参数错误",
      "112": "页面会话已过期，请刷新百度网盘页面",
      "31034": "访问过于频繁，请稍后重试",
      "31045": "访问过于频繁，请稍后重试",
      "31066": "文件不存在或已经被删除"
    };

    return (
      knownErrors[String(errno)] ||
      payload.errmsg ||
      payload.show_msg ||
      `百度接口错误（errno ${errno}）`
    );
  }
})();
