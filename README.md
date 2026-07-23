# 百度网盘直链助手

一个本地运行的 Chrome Manifest V3 扩展。它在你已经登录的百度网盘页面中读取当前目录，并通过同站登录态下载文件。

## 功能

- 自动识别 `https://pan.baidu.com/disk/main` 当前目录，包括 hash 中的 `path`
- 在 Chrome 侧边栏浏览目录、筛选和批量选择文件
- 生成百度 PCS 登录态下载地址
- 单条或批量复制下载地址
- 通过 Chrome 下载器携带百度登录态，不会跳离百度网盘文件页
- 复制带正确 User-Agent 的 aria2c 命令
- 显示服务器拒绝、网络失败等实际下载结果
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

点击“浏览器下载”后，请保持百度网盘登录状态。兼容下载入口可能受百度账号权益和服务器限速影响。

外部 aria2c 不会继承 Chrome 的百度登录态。点击“复制 aria2c”时，扩展会先在
Chrome 登录会话中换取短时效的百度 CDN 地址，然后把带正确 User-Agent 的命令
复制到剪贴板。扩展不会读取或导出 Cookie；临时地址过期后需要重新复制。

## 权限说明

- `tabs`：识别当前打开的百度网盘标签页
- `scripting`：扩展安装后无需手动刷新即可补充加载页面脚本
- `sidePanel`：显示目录和解析结果
- `downloads`：读取 Chrome 中百度下载任务的完成或失败状态
- `storage`：在下载期间暂存本扩展创建的任务编号和预期文件大小
- `declarativeNetRequestWithHostAccess`：仅为百度下载域名补充下载所需的
  `User-Agent` 和 `Referer`
- `https://pan.baidu.com/*`：只访问百度网盘自己的页面和接口
- `https://c.pcs.baidu.com/*`：使用百度 PCS 兼容下载入口
- `https://d.pcs.baidu.com/*`：下载百度服务器返回的文件直链
- `https://*.baidupcs.com/*`：跟随百度 PCS 返回的 CDN 下载地址

## 限制

- 必须先在 `pan.baidu.com` 登录
- 扩展只显示百度服务器为当前账号返回的地址，不绕过文件权限、会员权益或百度网盘限速
- 百度网盘是非公开网页接口，页面或接口改版后可能需要调整
- 请仅下载你有权访问和使用的文件，并遵守百度网盘服务条款
