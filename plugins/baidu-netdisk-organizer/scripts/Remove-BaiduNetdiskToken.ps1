$ErrorActionPreference = 'Stop'
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$targets = @('access-token.dpapi', 'token-metadata.json', 'oauth-state.txt')
$removed = 0
foreach ($name in $targets) {
    $target = Join-Path $stateRoot $name
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Force
        $removed += 1
    }
}
Write-Host "Removed $removed local credential/state file(s)."
Write-Host 'Also revoke the app in Baidu account authorization management if the token may have leaked.'
