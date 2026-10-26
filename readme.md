# 使用说明

需要配合 [Flow2api](https://github.com/TheSmallHanCat/flow2api) 服务使用。

## 一、 安装步骤

1.  **打开扩展程序页面**
    在 Chrome 浏览器地址栏输入并访问：
    `chrome://extensions/`

2.  **开启开发者模式**
    点击页面右上角的 **“开发者模式”** 开关。
    ![开启开发者模式](image.png)

3.  **载入插件**
    将解压后的插件目录直接 **拖拽** 到浏览器页面中，或点击“加载已解压的扩展程序”选择该目录。
    ![安装插件](image-1.png)

更新扩展文件后，请在 `chrome://extensions/` 或 `edge://extensions/` 中点击该扩展的“重新加载”。如浏览器提示新增 Google 访问权限，请允许后重新同步登录态。

## 二、 配置指南

1.  **设置接口与 Token**
    点击插件图标，在弹出窗口中配置 **连接接口 (API URL)**、**连接 Token** 和当前 **Google 账号**。连接 Token 仅保存在本机浏览器中，不会通过 Chrome 同步。刷新时间默认 60 分钟。
    ![配置界面](image-2.png)

2.  **获取配置信息**
    如果您不知道如何填写，请登录 **Flow2api 后台** 查看相关的接口地址和访问密钥。
    ![后台查看配置](image-3.png)

3.  **多账号浏览器**
    在插件中填写当前使用的 Flow 账号邮箱，确保 Cookie 更新后仍能准确更新同一个账号。同步前请确认当前浏览器配置中的 `https://flow.google.com/projects` 可以正常打开。插件会按浏览器访问 Flow 时实际携带的 Cookie 范围同步登录态，并保留 Cookie 的域名、路径和同名项。

4.  **连接权限**
    扩展需要 Google 域名的 HTTP 和 HTTPS 访问权限，以完整读取 Flow 登录 Cookie。HTTP 权限用于读取 `SID`、`HSID`、`APISID`、`SIDCC` 等未标记为 Secure 的 Cookie；Flow 页面仍通过 HTTPS 访问。

    首次保存配置时，浏览器还会请求访问对应 Flow2API 服务地址。额外授权仅针对当前填写的服务地址，用于提交登录态。

    使用非本机 HTTP 地址时，扩展会提示 Google 登录 Cookie 和连接 Token 将通过明文网络传输。公网部署建议先配置 HTTPS；确认继续后，授权仅对当前填写的来源生效。

## 三、 稳定性处理

- 同一时间只执行一个同步任务，避免定时任务与手动测试重复提交。
- 网络请求超时为 30 秒，遇到网络错误、限流或服务端临时错误时最多重试两次。
- 日志最多保留 50 条，不记录连接 Token 或 Cookie 内容。
- 弹窗和扩展图标会显示最近一次同步结果，便于及时发现登录态失效。
- 仅上传浏览器访问 `flow.google.com/projects` 时实际匹配的 Cookie，不读取其他网站的 Cookie。
