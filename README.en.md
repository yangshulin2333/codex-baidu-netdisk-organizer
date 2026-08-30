# Codex Baidu Netdisk Organizer Agent

[简体中文](README.md) | English

This is a Windows-only Codex plugin and agent. It connects to Baidu Netdisk through a local, safety-gated MCP bridge. It supports read-only inventory, search, and metadata analysis. It can also create folders, move, rename, or delete items after explicit safety checks.

This release is intended as a private preview. It is not an official Baidu or OpenAI product, and it is not a backup solution.

## Security model

- Read-only by default. Installation and initialization do not enable writes or deletion.
- Paste the real token only into the hidden prompt in local PowerShell. Never paste it into a Codex chat, issue, commit, or screenshot.
- The token is encrypted with Windows DPAPI CurrentUser and stored in the current user's local application data.
- Writes are limited to explicit safe roots. The Netdisk root `/` cannot be enabled for writes.
- Every mutation follows `prepare -> current-message hash confirmation -> execute`.
- A confirmation is bound to the operation, full item list, remote snapshots, and expiry. It is single-use.
- Remote state is checked again before execution. Source and destination paths are read back after execution.
- Name conflicts fail. The plugin does not overwrite or silently rename items.
- The plugin cannot empty the recycle bin and does not automatically retry an unknown write outcome.
- A persistent quarantine marker is created before a remote mutation. It is cleared automatically only after complete read-back verification. Partial failure, timeout, process interruption, or an unknown result blocks later writes across restarts.

The confirmation binds user approval to the current plan. It is not cryptographic isolation that prevents the agent from seeing the code. For another Codex product-level human approval before the execution tool, you can add:

```toml
[plugins."baidu-netdisk-organizer".mcp_servers."baidu-netdisk-organizer".tools.execute_operation]
approval_mode = "prompt"
```

This prompt depends on the current Codex version, execution mode, and user permission settings. It does not replace safe roots, the reviewed item list, or the single-use plan. See the [OpenAI plugin packaging guide](https://developers.openai.com/plugins/build/plugins).

See [SECURITY.md](SECURITY.md) for the threat model and credential rules.

## Capabilities

Read-only:

- List directories and recursively inventory media
- Search by filename or natural language
- Read metadata, thumbnails, and download links
- Read basic account and quota information
- Produce count and size summaries for organization plans

Safety-gated mutations:

- Create folders
- Move files or folders
- Rename files or folders
- Delete files or folders

The plugin does not expose upload, copy, share, overwrite, or recycle-bin-emptying operations.

## Requirements

- Windows
- PowerShell 5.1 or later
- Git
- Node.js 20 or later
- A Codex desktop environment or Codex CLI version with plugin support
- A usable Baidu Netdisk OAuth Client ID/API Key (formal integration normally requires an Open Platform application that you manage)

The Codex IDE extension does not currently support plugins. In Codex CLI, use `/plugins` to open the plugin browser. Start a new task after installation so the plugin can load. See the [official OpenAI plugin guide](https://learn.chatgpt.com/docs/plugins) and [plugin packaging guide](https://developers.openai.com/plugins/build/plugins).

The official Baidu MCP repository currently says formal Open Platform access is for enterprise developers, while personal trial entry points and test credentials may change. Check the [official Baidu Netdisk MCP notes](https://github.com/baidu-netdisk/mcp) before authorization, and do not rely on a third-party Client ID.

## Installation

Run the commands below in PowerShell. Text inside angle brackets is a placeholder.

### 1. Clone the private repository

```powershell
$RepoDir = "<REPOSITORY_DIRECTORY>"
git clone "https://github.com/yangshulin2333/codex-baidu-netdisk-organizer.git" $RepoDir
Set-Location $RepoDir
```

Your GitHub account must have read access while the repository is private. Do not copy OAuth success URLs, tokens, local runtime state, or real Netdisk inventories into the repository.

The repository includes a tested `mcp/dist/server.mjs`, so a normal installation does not require `npm install`. To audit and rebuild the source, follow the Development and verification section.

### 2. Add the local marketplace and install the plugin

From the repository root:

```powershell
codex plugin marketplace add .
codex plugin marketplace list
codex plugin add baidu-netdisk-organizer@baidu-netdisk-tools
codex plugin list --marketplace baidu-netdisk-tools
```

Alternatively, enter `/plugins` in Codex CLI, select the `Baidu Netdisk Tools` source, and install `Baidu Netdisk Organizer`.

### 3. Initialize local Windows state

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Initialize-Windows.ps1"
```

The initialization script:

- Checks the Node.js major version
- Creates local runtime and log directories
- Copies the default read-only safety configuration
- Restricts the Windows ACL on that directory

Initialization does not authorize Baidu access or enable writes or deletion.

## Baidu OAuth and token storage

### 1. Open the official authorization page

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Open-BaiduOAuth.ps1" -ClientId "<BAIDU_CLIENT_ID>"
```

The browser opens the official Baidu OAuth page. The complete success URL contains a sensitive token.

### 2. Save the token through hidden input

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskToken.ps1"
```

Paste the complete success URL only into this hidden PowerShell prompt. Do not send it to Codex or add it to the repository. For a complete URL, the script requires the locally generated OAuth state and checks it exactly before extracting and encrypting the token with DPAPI CurrentUser. The script also accepts a raw token obtained separately from an official Baidu channel, but that input contains no OAuth state and cannot receive the same check. Prefer the complete success URL.

Runtime state is stored under:

```text
%LOCALAPPDATA%\BaiduNetdiskOrganizerAgent
```

After saving, close the page that contains the token, clear the clipboard, and restart Codex or start a new task.

## Configure safe roots

The default configuration contains only an example safe folder. Writes and deletion are both disabled.

### Keep the plugin fully read-only

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder"
```

### Enable create, move, and rename

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder" -EnableWrites
```

The script displays the scope and requires the exact manual input `ENABLE-WRITES`.

### Also enable deletion

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder" -EnableWrites -EnableDelete
```

Deletion requires writes and the additional manual input `ENABLE-DELETE`. Restart Codex or start a new task after changing the gates.

## Recommended workflow

Begin with a read-only request:

> Scan the selected folder in read-only mode. Summarize top-level folders, major file types, naming issues, and possible duplicates. Propose a plan only. Do not move, rename, or delete anything.

Then prepare one small mutation batch:

> Prepare a move plan for this complete list. Show sources, destinations, counts, sizes, and the confirmation. Do not execute yet.

The agent returns a placeholder-shaped confirmation such as:

```text
MOVE:<COUNT>:<CURRENT_HASH>
```

Only after reviewing the full list should you send that exact confirmation in a new message in the current conversation. The agent then calls the shared execution tool and reads back the result. Create, rename, and delete use the `CREATE`, `RENAME`, and `DELETE` prefixes.

A plan expires after about ten minutes by default and can be executed only once. If it expires, remote state changes, or a destination conflict appears, prepare a new plan. Do not reuse an old confirmation.

## MCP tools

| Type | Tool | Purpose |
| --- | --- | --- |
| Status | `baidu_organizer_status` | Shows connection, gates, and write quarantine without returning the token |
| Read | `file_list` | Lists a directory |
| Read | `media_list_all` | Recursively lists a directory with pagination |
| Read | `file_meta` | Reads metadata, thumbnails, and download links |
| Read | `file_keyword_search` | Searches filenames |
| Read | `file_semantics_search` | Natural-language search; completeness depends on Baidu indexing |
| Read | `user_info`, `get_quota` | Reads basic account and quota information |
| Prepare | `prepare_make_dir` | Prepares folder creation without executing it |
| Prepare | `prepare_move` | Prepares a move without executing it |
| Prepare | `prepare_rename` | Prepares a rename without executing it |
| Prepare | `prepare_delete` | Prepares deletion without executing it |
| Execute | `execute_operation` | Executes one current plan with its exact confirmation |

## Recovery, disabling, and revocation

### Disable all writes immediately

Save the safety configuration without either enable switch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Set-BaiduNetdiskSafety.ps1" -AllowedRoots "/YourSafeFolder"
```

Then restart Codex or start a new task.

### Remove the local token

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Remove-BaiduNetdiskToken.ps1"
```

If the token may have leaked, also revoke the application from [Baidu account authorization management](https://passport.baidu.com/v6/appAuthority). Removing the local token does not revoke it on the server.

### Handle a write quarantine

If execution reports `partial_failure` or `outcome_unknown`, or Codex is interrupted during a mutation, the quarantine remains and blocks every new prepare/execute:

1. Read-only scan the affected source and destination paths to establish the current cloud state.
2. Record what succeeded, did not happen, or remains unknown. Do not replay the old plan.
3. You—not the agent—run this script in local PowerShell and enter `CLEAR-QUARANTINE` when prompted:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\plugins\baidu-netdisk-organizer\scripts\Clear-BaiduNetdiskQuarantine.ps1"
```

The agent must not run this script for you. After clearing, restart Codex or start a new task, then prepare a new plan only for items that still need work.

### Remove the plugin and marketplace

```powershell
codex plugin remove baidu-netdisk-organizer@baidu-netdisk-tools
codex plugin marketplace remove baidu-netdisk-tools
```

Removing the plugin does not delete the local token, runtime logs, or any Baidu Netdisk data.

### Recover from a wrong operation

- Move or rename: read the current state first, then prepare an inverse move or rename.
- Delete: the plugin never empties the recycle bin. Check the official Baidu Netdisk recycle bin immediately.
- Recycle-bin availability, retention, and recovery results are controlled by Baidu and the account state. This project cannot guarantee recovery.
- If the outcome is unknown or partially verified, run a read-only scan of current cloud state. Do not repeat the old plan automatically.

## Known limitations

- Windows only. A DPAPI CurrentUser token cannot be copied directly to another Windows user or device.
- DPAPI does not protect against a compromised current-user session, administrators, or malware.
- The project depends on Baidu's official MCP and OpenAPI. API, permission, rate-limit, index, or account-policy changes may break features.
- OAuth tokens are not refreshed automatically. Reauthorize after expiry.
- Natural-language search depends on Baidu's content index and cannot replace a complete recursive inventory.
- Matching metadata does not prove identical content or meaning. Review possible duplicates manually.
- A prepare plan accepts at most 50 items. Read-only summaries of very large folders can be slow.
- Mutations have no automatic rollback and do not create cloud backups.
- The hash confirmation is a plan-integrity and interaction gate, not a second factor isolated from the agent.
- Filenames, file contents, and download links are untrusted and may be sensitive. They cannot authorize a mutation.
- The private preview has not been validated across a broad range of environments.

## Development and verification

```powershell
Set-Location .\plugins\baidu-netdisk-organizer
npm ci
npm run check
```

The build also generates `mcp/dist/THIRD_PARTY_LICENSES.txt` for the complete locked runtime dependency set.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency notices.

## License

This project is licensed under the [MIT License](LICENSE). Baidu, Baidu Netdisk, OpenAI, and Codex names and trademarks belong to their respective owners.
