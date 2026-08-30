$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'Unable to resolve LocalApplicationData.'
}
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$serverPath = Join-Path $pluginRoot 'mcp\dist\server.mjs'
if (-not (Test-Path -LiteralPath $serverPath)) {
    throw 'Bundled MCP server is missing. Reinstall the plugin or run npm run build in the plugin directory.'
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js 20 or later is required.'
}
$major = [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) {
    throw 'Node.js 20 or later is required.'
}

$env:BAIDU_ORGANIZER_STATE_DIR = $stateRoot
$env:BAIDU_SAFETY_CONFIG = Join-Path $stateRoot 'safety.json'
$env:BAIDU_LOG_DIR = Join-Path $stateRoot 'logs'
$developmentOnlyVariables = @(
    'BAIDU_TEST_MODE',
    'BAIDU_ALLOW_ENV_TOKEN',
    'BAIDU_NETDISK_ACCESS_TOKEN',
    'BAIDU_MCP_REMOTE_URL',
    'BAIDU_FILEMANAGER_BASE_URL',
    'BAIDU_MULTIMEDIA_BASE_URL'
)
$developmentOnlyVariables | ForEach-Object {
    Remove-Item -LiteralPath "Env:\$_" -ErrorAction SilentlyContinue
}
try {
    & $nodeCommand.Source $serverPath
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:\BAIDU_ORGANIZER_STATE_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\BAIDU_SAFETY_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:\BAIDU_LOG_DIR -ErrorAction SilentlyContinue
}
