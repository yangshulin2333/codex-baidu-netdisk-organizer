param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]{8,}$')]
    [string]$ClientId
)

$ErrorActionPreference = 'Stop'
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the OAuth state directory ACL. Authorization was not opened.' }

$state = [Guid]::NewGuid().ToString('N')
$statePath = Join-Path $stateRoot 'oauth-state.txt'
Set-Content -LiteralPath $statePath -Value $state -Encoding ascii -NoNewline

$queryParts = [ordered]@{
    response_type = 'token'
    client_id = $ClientId
    redirect_uri = 'oob'
    scope = 'basic,netdisk'
    state = $state
}
$encodedQuery = ($queryParts.GetEnumerator() | ForEach-Object {
    '{0}={1}' -f [Uri]::EscapeDataString([string]$_.Key), [Uri]::EscapeDataString([string]$_.Value)
}) -join '&'
$authorizeUrl = 'https://openapi.baidu.com/oauth/2.0/authorize?' + $encodedQuery

Start-Process $authorizeUrl
Write-Host 'Opened the official Baidu OAuth page in your browser.'
Write-Host 'After approval, copy the complete success URL and paste it only into Set-BaiduNetdiskToken.ps1.'
Write-Host 'Never paste the URL or Access Token into a Codex conversation, issue, commit, or screenshot.'
