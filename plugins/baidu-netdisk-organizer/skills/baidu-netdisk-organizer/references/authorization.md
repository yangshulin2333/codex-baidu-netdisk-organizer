# 百度授权与本机凭据

仅在连接缺失、令牌过期、撤销授权或用户询问凭据存储时阅读本文件。

## 信任边界

- 用户使用自己的百度开发者应用和 API Key（OAuth `client_id`）完成官方授权。
- Client Secret 不应提供给此插件，也不得出现在对话、命令行参数、环境截图、Issue 或提交中。
- OAuth 成功网址包含 Access Token，等同凭据。只允许粘贴到本机 PowerShell 的隐藏输入提示。
- 插件不应读取浏览器地址栏、剪贴板或聊天消息来收集凭据。

## Windows 初始化

以下命令从插件根目录运行；路径含空格时保持引号：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Initialize-Windows.ps1"
```

该脚本检查 Node.js 20+，初始化 `%LOCALAPPDATA%\BaiduNetdiskOrganizerAgent`，限制目录 ACL，并写入默认关闭写入和删除的安全配置。

使用自己的百度 API Key 打开官方 OAuth 页面：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Open-BaiduOAuth.ps1" -ClientId "YOUR_BAIDU_API_KEY"
```

授权成功后，将浏览器地址栏中的完整成功网址仅粘贴到以下脚本的隐藏输入：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\Set-BaiduNetdiskToken.ps1"
```

粘贴完整成功网址时，脚本要求本机存在刚生成的 OAuth `state` 并精确验证；随后用 Windows CurrentUser DPAPI 加密令牌，并仅保存令牌指纹和有效期元数据。脚本也接受由百度官方渠道单独取得的原始令牌，但原始令牌输入没有 state 可核对，应优先使用完整成功网址。明文不会写入 Codex 配置或仓库。

完成后重启 Codex 或新建任务，再调用：

```text
baidu_organizer_status {"probe_remote": true}
```

只有 `tokenConfigured=true` 且只读探测成功，才可宣称连接已验证。进程存在、配置文件存在或有令牌指纹都不等于远端连接成功。

## 过期、撤销与故障

- 令牌过期：重新走 OAuth，并再次运行隐藏输入脚本；不要要求用户把错误页面或成功网址发到聊天。
- 本机撤销：运行 `Remove-BaiduNetdiskToken.ps1`，随后重启 Codex。
- 账号侧撤销：由用户在百度账号的应用授权管理页面解除关联。
- 指纹只用于区分本机令牌版本，不是令牌，也不能证明权限范围正确。
- 错误信息如疑似包含令牌，先停止展示并做脱敏；不要把原始响应提交到公开 Issue。

## 不可声称的能力

不要把此流程描述为免登录、永久授权或自动续期。OAuth 页面、有效期和百度接口可用性由百度控制；无法现场验证时要明确说明。
