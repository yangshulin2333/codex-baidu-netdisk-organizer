param(
    [Parameter(Mandatory = $true)]
    [ValidateCount(1, 50)]
    [string[]]$AllowedRoots,
    [switch]$EnableWrites,
    [switch]$EnableDelete,
    [ValidateRange(1, 50)]
    [int]$MaxBatchSize = 50,
    [ValidateRange(60, 3600)]
    [int]$PlanTtlSeconds = 600
)

$ErrorActionPreference = 'Stop'
if ($EnableDelete -and -not $EnableWrites) {
    throw 'Delete cannot be enabled while writes are disabled.'
}

$normalizedRoots = @()
foreach ($root in $AllowedRoots) {
    $value = $root.Trim().Replace('\', '/')
    if (-not $value.StartsWith('/')) { throw "Absolute Netdisk path required: $value" }
    $segments = @(($value -split '/') | Where-Object { $_ })
    if ($segments -contains '.' -or $segments -contains '..') { throw "Netdisk path cannot contain . or ..: $value" }
    $value = '/' + ($segments -join '/')
    if ($value -eq '/') { throw 'The Netdisk root / cannot be enabled for writes.' }
    if ($normalizedRoots -notcontains $value) { $normalizedRoots += $value }
}

Write-Host 'Allowed write roots:'
$normalizedRoots | ForEach-Object { Write-Host "  $_" }
Write-Host "Writes enabled: $($EnableWrites.IsPresent)"
Write-Host "Deletes enabled: $($EnableDelete.IsPresent)"
if ($EnableWrites) {
    $answer = Read-Host 'Type ENABLE-WRITES to continue'
    if ($answer -ne 'ENABLE-WRITES') { throw 'Safety configuration was not changed.' }
}
if ($EnableDelete) {
    $answer = Read-Host 'Type ENABLE-DELETE to continue'
    if ($answer -ne 'ENABLE-DELETE') { throw 'Safety configuration was not changed.' }
}

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$configPath = Join-Path $stateRoot 'safety.json'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the runtime state directory ACL. Safety configuration was not changed.' }

$config = [ordered]@{
    allowedRoots = $normalizedRoots
    writesEnabled = $EnableWrites.IsPresent
    deleteEnabled = $EnableDelete.IsPresent
    maxBatchSize = $MaxBatchSize
    planTtlSeconds = $PlanTtlSeconds
    logRetentionDays = 7
}
$temporaryPath = Join-Path $stateRoot ('.safety-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$backupPath = Join-Path $stateRoot ('.safety-' + [Guid]::NewGuid().ToString('N') + '.bak')
try {
    $json = $config | ConvertTo-Json -Depth 4
    [IO.File]::WriteAllText($temporaryPath, $json, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        [IO.File]::Replace($temporaryPath, $configPath, $backupPath, $true)
    }
    else {
        [IO.File]::Move($temporaryPath, $configPath)
    }
}
finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
}

Write-Host "Safety configuration saved to: $configPath"
Write-Host 'Restart Codex or start a new task before using the changed gates.'
