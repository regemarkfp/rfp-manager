# Wraps a Lottie .json export as a .js file (window.LOTTIE_DATA = ...) so CasparCG can load it from file://
# Usage:  powershell -ExecutionPolicy Bypass -File tools\wrap-lottie.ps1 -In C:\exports\bug.json -Out templates\cricketcg\lottie\bug_lottie.js
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
$json = Get-Content -Raw -Encoding UTF8 $In
Set-Content -Encoding UTF8 -Path $Out -Value ("window.LOTTIE_DATA = " + $json.Trim() + ";")
Write-Host "Wrote $Out"
