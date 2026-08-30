$ErrorActionPreference = 'Stop'

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$quarantinePath = Join-Path $stateRoot 'write-quarantine.json'

if (-not (Test-Path -LiteralPath $quarantinePath -PathType Leaf)) {
    Write-Host 'No write quarantine is active.'
    exit 0
}

$state = 'corrupt-or-unreadable'
$operation = '<unknown>'
$startedAt = '<unknown>'
try {
    $marker = Get-Content -LiteralPath $quarantinePath -Raw | ConvertFrom-Json
    if ($marker.state -eq 'pending') { $state = 'pending' }
    if ($marker.operation -in @('create', 'move', 'rename', 'delete')) { $operation = $marker.operation }
    if ($marker.startedAt) { $startedAt = [string]$marker.startedAt }
}
catch {
    # Never print the marker contents. A malformed marker still fails closed.
}

Write-Host 'A persistent write quarantine is active.'
Write-Host "State: $state"
Write-Host "Operation: $operation"
Write-Host "Started at: $startedAt"
Write-Host 'Before clearing it, use read-only tools to verify the current cloud state.'
$answer = Read-Host 'Type CLEAR-QUARANTINE only after that verification'
if ($answer -ne 'CLEAR-QUARANTINE') {
    throw 'Write quarantine was not cleared.'
}

Remove-Item -LiteralPath $quarantinePath -Force
Write-Host 'Write quarantine cleared. Restart Codex or start a new task before preparing another mutation.'
