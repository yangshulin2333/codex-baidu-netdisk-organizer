$ErrorActionPreference = 'Stop'

$pluginRoot = Split-Path -Parent $PSScriptRoot
$exampleConfig = Join-Path $pluginRoot 'mcp\config\safety.example.json'
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$configPath = Join-Path $stateRoot 'safety.json'

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js 20 or later is required. Install Node.js, then run this script again.'
}
$major = [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) {
    throw 'Node.js 20 or later is required.'
}

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stateRoot 'logs') | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to restrict the runtime state directory ACL.'
}
if (-not (Test-Path -LiteralPath $configPath)) {
    Copy-Item -LiteralPath $exampleConfig -Destination $configPath
}

Write-Host "Initialized local state: $stateRoot"
Write-Host 'Writes and deletes remain disabled by default.'
Write-Host 'Next: run Open-BaiduOAuth.ps1 with your own Baidu API Key, then Set-BaiduNetdiskToken.ps1.'
