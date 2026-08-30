$ErrorActionPreference = 'Stop'

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$stateRoot = Join-Path $localAppData 'BaiduNetdiskOrganizerAgent'
$tokenPath = Join-Path $stateRoot 'access-token.dpapi'
$metadataPath = Join-Path $stateRoot 'token-metadata.json'
$expectedStatePath = Join-Path $stateRoot 'oauth-state.txt'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $stateRoot '/inheritance:r' '/grant:r' "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict the token directory ACL. Nothing was saved.' }

Write-Host 'Paste the complete Baidu OAuth success URL or a raw Access Token.'
Write-Host 'Input is hidden and is not sent to Codex chat.'
$secureInput = Read-Host 'OAuth URL or Access Token' -AsSecureString
$inputPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
try {
    $inputValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($inputPointer).Trim()
    $isUrl = $inputValue -match '(?:^|[?#&])access_token=([^&]+)'
    if ($isUrl) {
        $oauthUri = $null
        $validOAuthUri = [Uri]::TryCreate($inputValue, [UriKind]::Absolute, [ref]$oauthUri) -and
            $oauthUri.Scheme -eq 'https' -and
            $oauthUri.Host -eq 'openapi.baidu.com' -and
            $oauthUri.AbsolutePath -eq '/oauth/2.0/login_success' -and
            $oauthUri.IsDefaultPort -and
            [string]::IsNullOrWhiteSpace($oauthUri.UserInfo)
        if (-not $validOAuthUri) {
            throw 'The OAuth success URL is not the expected official Baidu URL. Nothing was saved.'
        }
        $tokenValue = [Uri]::UnescapeDataString($Matches[1])
        $expiresIn = if ($inputValue -match '(?:^|[?#&])expires_in=([0-9]+)') { [int64]$Matches[1] } else { $null }
        $returnedState = if ($inputValue -match '(?:^|[?#&])state=([^&]+)') { [Uri]::UnescapeDataString($Matches[1]) } else { $null }
        if (-not (Test-Path -LiteralPath $expectedStatePath)) {
            throw 'OAuth state is missing. Run Open-BaiduOAuth.ps1 again. Nothing was saved.'
        }
        $expectedState = (Get-Content -LiteralPath $expectedStatePath -Raw).Trim()
        if ([string]::IsNullOrWhiteSpace($returnedState) -or $returnedState -ne $expectedState) {
            throw 'OAuth state did not match. Nothing was saved.'
        }
    }
    else {
        $tokenValue = $inputValue
        $expiresIn = $null
    }

    if ($tokenValue -notmatch '^[A-Za-z0-9._~-]{20,}$') {
        throw 'The Access Token format is invalid. Nothing was saved.'
    }

    $secureToken = ConvertTo-SecureString -String $tokenValue -AsPlainText -Force
    $encrypted = ConvertFrom-SecureString $secureToken
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $fingerprint = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($tokenValue)))).Replace('-', '').Substring(0, 8).ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($inputPointer)
    $inputValue = $null
    $tokenValue = $null
}

Set-Content -LiteralPath $tokenPath -Value $encrypted -Encoding ascii -NoNewline
$now = [DateTimeOffset]::UtcNow
$metadata = [ordered]@{
    savedAt = $now.ToString('o')
    expiresAt = if ($expiresIn) { $now.AddSeconds($expiresIn).ToString('o') } else { $null }
    fingerprint = $fingerprint
    storage = 'Windows CurrentUser DPAPI'
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8
Remove-Item -LiteralPath $expectedStatePath -Force -ErrorAction SilentlyContinue

(Get-Item -LiteralPath $tokenPath).Attributes = (Get-Item -LiteralPath $tokenPath).Attributes -bor [IO.FileAttributes]::Hidden

Write-Host "Token encrypted with Windows DPAPI. Fingerprint: $fingerprint"
Write-Host 'Restart Codex or start a new task before testing the MCP connection.'
