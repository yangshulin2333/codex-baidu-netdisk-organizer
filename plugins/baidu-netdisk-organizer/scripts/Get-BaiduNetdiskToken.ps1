param(
    [Parameter(Mandatory = $true)]
    [string]$TokenPath
)

$ErrorActionPreference = 'Stop'
$encrypted = Get-Content -LiteralPath $TokenPath -Raw
$secureToken = ConvertTo-SecureString $encrypted
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer))
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}
