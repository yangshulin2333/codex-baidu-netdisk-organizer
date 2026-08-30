# Codex 百度网盘整理 Agent

简体中文 | [English](README.en.md)

这是一个仅面向 Windows 的 Codex 插件/Agent，用本地 MCP 安全桥连接百度网盘，支持只读盘点、搜索和元数据分析，并在多重门禁下创建目录、移动、重命名或删除文件。

当前版本定位为私有预览版。它不是百度或 OpenAI 的官方产品，也不是备份工具。

## 安全设计

- 默认只读；安装和初始化不会自动开启写入或删除。
- 真实令牌只允许在本机 PowerShell 的隐藏输入框中粘贴，禁止粘贴到 Codex 对话、Issue、提交记录或截图。
- 令牌使用 Windows DPAPI CurrentUser 加密，并保存在当前 Windows 用户的本地应用数据目录。
- 写入仅限显式配置的网盘安全根目录；网盘根目录 `/` 不能被设为写入范围。
- 每个写操作都必须经过 `prepare -> 当前消息中的哈希确认 -> execute`。
- 确认码与操作类型、完整清单、远端状态快照和有效期绑定，只能使用一次。
- 执行前重新核对远端状态，执行后回读源路径和目标路径。
- 同名冲突直接失败，不覆盖、不自动改名。
- 不提供清空回收站能力，也不会自动重试结果未知的写操作。
- 远端写入开始前创建持久隔离标记；只有完整回读验收成功才自动解除。部分失败、超时、进程中断或结果未知会跨重启阻止后续写入。

确认码用于把用户确认绑定到当前计划，并不构成“Agent 无法看见确认码”的密码学隔离。若希望在执行工具前再增加一层 Codex 产品级人工批准，可在 Codex 配置中加入：

```toml
[plugins."baidu-netdisk-organizer".mcp_servers."baidu-netdisk-organizer".tools.execute_operation]
approval_mode = "prompt"
```

这层提示受当前 Codex 版本、运行模式和用户权限设置影响，不能替代安全根目录、预检清单和一次性计划。配置语法见 [OpenAI 插件打包文档](https://developers.openai.com/plugins/build/plugins)。

详细威胁模型和凭据处理规则见 [SECURITY.md](SECURITY.md)。

## 能力

只读能力：

- 列出目录和递归媒体清单
- 按文件名或自然语言搜索
- 读取文件元数据、缩略图和下载链接
- 读取账号基本信息和容量
- 为整理方案生成数量与容量摘要

受控写入能力：

- 创建目录
- 移动文件或目录
- 重命名文件或目录
- 删除文件或目录

插件不提供上传、复制、分享、覆盖写入或清空回收站。

## 运行要求

- Windows
- PowerShell 5.1 或更高版本
- Git
- Node.js 20 或更高版本
- 支持插件的 Codex 桌面环境或 Codex CLI
- 可用的百度网盘 OAuth Client ID/API Key（正式接入通常需要自行管理百度开放平台应用）

Codex IDE 扩展当前不支持插件。Codex CLI 可以用 `/plugins` 打开插件浏览器。安装后需要新建任务，插件能力才会加载。安装行为以 [OpenAI 官方插件文档](https://learn.chatgpt.com/docs/plugins)和[插件打包文档](https://developers.openai.com/plugins/build/plugins)为准。

百度官方 MCP 仓库当前说明：正式开放平台接入面向企业开发者，个人体验入口和测试密钥可能变化。授权前请核对[百度网盘官方 MCP 说明](https://github.com/baidu-netdisk/mcp)，不要依赖第三方提供的 Client ID。

## 安装

以下命令都从 PowerShell 执行。尖括号内容是占位符，不能原样使用。

### 1. 克隆私有仓库

```powershell
$RepoDir = "<REPOSITORY_DIRECTORY>"
git clone "https://github.com/yangshulin2333/codex-baidu-netdisk-organizer.git" $RepoDir
Set-Location $RepoDir
```

该仓库为私有仓库时，GitHub 账号必须已有读取权限。不要把 OAuth 成功网址、令牌、本机运行目录或真实网盘清单复制到仓库。

仓库已提交经过测试的 `mcp/dist/server.mjs`，普通安装不需要运行 `npm install`。如需审查源码并自行重建，请按“开发与验证”章节操作。

### 2. 添加本地 marketplace 并安装插件

从仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin marketplace list
codex plugin add baidu-netdisk-organizer@baidu-netdisk-tools
codex plugin list --marketplace baidu-netdisk-tools
```

也可以在 Codex CLI 中输入 `/plugins`，选择 `Baidu Netdisk Tools` 来源后安装 `Baidu Netdisk Organizer`。

### 3. 初始化 Windows 本地状态

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Initialize-Windows.ps1"
```

初始化脚本会：

- 检查 Node.js 主版本
- 创建本机运行状态与日志目录
- 复制默认只读安全配置
- 收紧该目录的 Windows ACL

初始化不会取得百度授权，也不会开启写入或删除。

## 百度 OAuth 与令牌保存

### 1. 打开官方授权页

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Open-BaiduOAuth.ps1" -ClientId "<BAIDU_CLIENT_ID>"
```

浏览器会打开百度官方 OAuth 页面。授权完成后，完整成功网址中含有敏感令牌。

### 2. 在隐藏输入中保存令牌

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskToken.ps1"
```

只把完整成功网址粘贴到这个 PowerShell 隐藏输入框。不要发给 Codex，也不要放入仓库。使用完整成功网址时，脚本要求本机存在刚生成的 OAuth state，并精确验证后才提取令牌和使用 DPAPI CurrentUser 加密保存。脚本也兼容从百度官方渠道单独取得的原始令牌，但该输入不包含 OAuth state，无法进行同等校验，优先使用完整成功网址。

运行状态默认位于：

```text
%LOCALAPPDATA%\BaiduNetdiskOrganizerAgent
```

保存完成后，关闭含令牌的网址页面并清理剪贴板，然后重启 Codex 或新建任务。

## 配置安全根目录

默认配置只有一个示例安全目录，同时写入和删除都关闭。

### 保持完全只读

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder"
```

### 开启创建、移动和重命名

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder" -EnableWrites
```

脚本会显示允许范围，并要求手工输入 `ENABLE-WRITES`。

### 额外开启删除

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder" -EnableWrites -EnableDelete
```

删除必须同时开启写入，并额外手工输入 `ENABLE-DELETE`。每次修改门禁后都应重启 Codex 或新建任务。

## 建议使用方式

先让 Agent 保持只读：

> 只读扫描指定目录，统计一级目录、主要文件类型、命名问题和疑似重复内容。只给整理方案，不移动、重命名或删除。

确认方案后，按一个小批次准备写操作：

> 为以下完整清单生成移动预检计划，展示源路径、目标路径、数量、容量和确认码。现在不要执行。

Agent 会返回类似下面的占位格式：

```text
MOVE:<COUNT>:<CURRENT_HASH>
```

只有在你核对完整清单后，才在当前对话的新消息中原样回复这次确认码。Agent 随后调用统一执行工具，并回读验证结果。创建、重命名和删除分别使用 `CREATE`、`RENAME` 和 `DELETE` 前缀。

计划默认约十分钟失效，且只能执行一次。计划过期、远端状态变化或出现同名目标时，必须重新 `prepare`，不能沿用旧确认码。

## 可用 MCP 工具

| 类型 | 工具 | 说明 |
| --- | --- | --- |
| 状态 | `baidu_organizer_status` | 查看令牌状态、连接状态、门禁和写入隔离，不返回令牌 |
| 只读 | `file_list` | 列出目录 |
| 只读 | `media_list_all` | 分页递归列出目录内容 |
| 只读 | `file_meta` | 读取元数据、缩略图和下载链接 |
| 只读 | `file_keyword_search` | 按文件名搜索 |
| 只读 | `file_semantics_search` | 自然语言搜索，结果依赖百度索引 |
| 只读 | `user_info`、`get_quota` | 读取账号基础信息和容量 |
| 预检 | `prepare_make_dir` | 准备创建目录，不执行 |
| 预检 | `prepare_move` | 准备移动，不执行 |
| 预检 | `prepare_rename` | 准备重命名，不执行 |
| 预检 | `prepare_delete` | 准备删除，不执行 |
| 执行 | `execute_operation` | 使用当前计划和精确确认码执行一次 |

## 恢复、停用与撤销

### 立即关闭全部写操作

重新保存安全配置但不传入启用开关：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder"
```

然后重启 Codex 或新建任务。

### 撤销本机令牌

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Remove-BaiduNetdiskToken.ps1"
```

如果令牌可能泄露，还应在[百度账号授权管理](https://passport.baidu.com/v6/appAuthority)中解除该应用授权。本机删除令牌不等于服务端撤销。

### 处理写入隔离

如果执行结果为 `partial_failure`、`outcome_unknown`，或 Codex 在写入期间中断，隔离会保留并阻止所有新的 prepare/execute：

1. 只读扫描相关源路径和目标路径，确认云端当前状态。
2. 记录已经成功、未发生和无法判断的项目；不要重放原计划。
3. 由你本人在本机 PowerShell 运行以下脚本，并按提示输入 `CLEAR-QUARANTINE`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Clear-BaiduNetdiskQuarantine.ps1"
```

Agent 不得代替你运行该脚本。解除后重启 Codex 或新建任务，再为仍需处理的项目生成新计划。

### 卸载插件和 marketplace

```powershell
codex plugin remove baidu-netdisk-organizer@baidu-netdisk-tools
codex plugin marketplace remove baidu-netdisk-tools
```

卸载插件不会自动删除本机令牌、运行日志或百度网盘中的任何内容。

### 恢复误操作

- 移动或重命名：先只读核对当前位置，再准备一条反向移动或重命名计划。
- 删除：插件不会清空回收站。请立即到百度网盘官方回收站检查是否可恢复。
- 百度网盘的回收站可用性、保留期限和恢复结果由百度及账号状态决定，本项目不作保证。
- 如果执行结果显示未知或部分失败，只读重新扫描当前云端状态；不要直接重复执行原计划。

## 已知局限

- 仅支持 Windows；DPAPI CurrentUser 令牌不能直接迁移到另一个 Windows 用户或设备。
- DPAPI 不能抵御已控制当前 Windows 用户会话、管理员权限或恶意软件的攻击。
- 依赖百度官方 MCP 与 OpenAPI；接口、权限、限流、索引和账号策略变化可能导致功能失效。
- OAuth 令牌不会自动刷新；过期后需要重新授权。
- 自然语言搜索结果取决于百度是否已建立内容索引，不能替代完整递归清单。
- 元数据相同不代表文件内容或语义完全相同；疑似重复仍需人工确认。
- 单个预检计划最多 50 项；超大目录的只读汇总可能耗时。
- 写操作没有自动回滚，也不会生成云端备份。
- 哈希确认码是计划完整性和交互流程门禁，不是与 Agent 隔离的第二因子。
- 文件名、文件内容和分享链接均属于不可信且可能敏感的数据，不应直接作为授权指令。
- 私有预览版尚未经过广泛环境兼容性验证。

## 开发与验证

```powershell
Set-Location .\plugins\baidu-netdisk-organizer
npm ci
npm run check
```

构建同时生成锁定依赖的完整许可证汇总 `mcp/dist/THIRD_PARTY_LICENSES.txt`。

提交变更前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。第三方组件与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。百度、百度网盘、OpenAI 和 Codex 等名称及商标归各自权利人所有。
