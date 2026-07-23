# 百度网盘直链助手

一个本地运行的 Chrome Manifest V3 扩展。它在你已经登录的百度网盘页面中读取当前目录，并解析百度服务器为文件返回的临时下载直链。

## 功能

- 自动识别 `https://pan.baidu.com/disk/main` 当前目录，包括 hash 中的 `path`
- 在 Chrome 侧边栏浏览目录、筛选和批量选择文件
- 通过百度 `xpan/multimedia` 文件元数据接口批量解析 `dlink`
- 单条或批量复制直链
- 从已登录的百度网盘页面发起浏览器下载，保留同站登录上下文
- 显示服务器拒绝、网络失败等实际下载结果
- 复制带百度网盘客户端 `User-Agent` 的 aria2 命令
- 不读取或导出 Cookie，不连接第三方服务器

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions/`
2. 开启右上角的“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目的 `baidu-pan-direct-link` 文件夹
5. 打开并登录百度网盘文件页
6. 点击浏览器工具栏里的扩展图标，侧边栏会自动打开

如果扩展是在百度网盘页面已经打开之后安装的，请刷新一次该页面。

## 使用

打开类似下面的页面：

```text
https://pan.baidu.com/disk/main?from=homeFlow#/index?category=all&path=%2Fsw
```

在侧边栏中选择文件，然后点击“解析直链”。文件夹可以点击“进入”继续浏览。

直链通常具有时效，过期后需要重新解析。对于浏览器无法直接下载的大文件，可以点击“复制 aria2”，在已安装 aria2 的终端中运行。

## 权限说明

- `tabs`：识别当前打开的百度网盘标签页
- `scripting`：扩展安装后无需手动刷新即可补充加载页面脚本
- `sidePanel`：显示目录和解析结果
- `downloads`：把解析后的地址交给 Chrome 下载
- `declarativeNetRequestWithHostAccess`：仅为百度下载域名补充下载所需的
  `User-Agent` 和 `Referer`
- `https://pan.baidu.com/*`：只访问百度网盘自己的页面和接口
- `https://d.pcs.baidu.com/*`：下载百度服务器返回的文件直链

## 限制

- 必须先在 `pan.baidu.com` 登录
- 扩展只显示百度服务器为当前账号返回的地址，不绕过文件权限、会员权益或百度网盘限速
- 百度网盘是非公开网页接口，页面或接口改版后可能需要调整
- 请仅下载你有权访问和使用的文件，并遵守百度网盘服务条款
