# Diagnostic: list approved Twilio regulatory bundles + addresses for the
# account configured in .env.local, then print the env-var lines to copy
# into Vercel.
#
# Reads credentials from ../.env.local — never hardcode secrets in this file.

$envPath = Join-Path $PSScriptRoot "..\.env.local"
if (!(Test-Path $envPath)) {
    Write-Error "Cannot find .env.local at $envPath"
    exit 1
}
$envLines = Get-Content $envPath
$sid   = ($envLines | Where-Object { $_ -match '^TWILIO_ACCOUNT_SID=' })   -replace '^TWILIO_ACCOUNT_SID=',   ''
$token = ($envLines | Where-Object { $_ -match '^TWILIO_AUTH_TOKEN=' })    -replace '^TWILIO_AUTH_TOKEN=',    ''
if (!$sid -or !$token) {
    Write-Error "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing from .env.local"
    exit 1
}

$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${sid}:${token}"))
$h    = @{ Authorization = "Basic $auth" }

Write-Host ""
Write-Host "=== Approved Regulatory Bundles ===" -ForegroundColor Cyan
$bundles = Invoke-RestMethod -Uri "https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles?Status=twilio-approved&PageSize=50" -Headers $h
$picks = @{}
foreach ($b in $bundles.results) {
    $reg = Invoke-RestMethod -Uri "https://numbers.twilio.com/v2/RegulatoryCompliance/Regulations/$($b.regulation_sid)" -Headers $h
    $key = "{0}_{1}" -f $reg.iso_country, $reg.number_type.ToUpper()
    "{0,-36}  {1,-3}  {2,-9}  {3}" -f $b.sid, $reg.iso_country, $reg.number_type, $b.friendly_name
    if (-not $picks.ContainsKey($key)) { $picks[$key] = $b.sid }
}

Write-Host ""
Write-Host "=== Addresses (all GB) ===" -ForegroundColor Cyan
$addrs = Invoke-RestMethod -Uri "https://api.twilio.com/2010-04-01/Accounts/$sid/Addresses.json?PageSize=50" -Headers $h
foreach ($a in $addrs.addresses) {
    "{0,-36}  {1,-3}  {2}" -f $a.sid, $a.iso_country, $a.customer_name
}

Write-Host ""
Write-Host "=== Suggested env vars for Vercel ===" -ForegroundColor Cyan
Write-Host "(Bundles contain their own regulatory address — omit TWILIO_DEFAULT_ADDRESS_SID_GB unless you have a standalone address you specifically want used.)"
"TWILIO_ACCOUNT_SID=$sid"
foreach ($k in ($picks.Keys | Sort-Object)) {
    "TWILIO_DEFAULT_BUNDLE_SID_$k=$($picks[$k])"
}
if ($picks.ContainsKey('GB_LOCAL')) { "TWILIO_DEFAULT_BUNDLE_SID_GB=$($picks['GB_LOCAL'])" }
