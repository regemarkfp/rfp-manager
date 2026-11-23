# Builds RFP Scopes for Windows into one folder (-Stage), ready to zip or to make the installer from:
#   RFP Scopes.exe · VERSION · webview2\ (WebView2 parts) · app\ (the screen: scopes.html, scopes.js, fonts …)
# With the C# compiler that comes with Windows (.NET Framework 4). The WebView2 SDK comes from tools\launcher\webview2
# (RFP Manager's build fetches it once from nuget.org) or is fetched here.
#   powershell -ExecutionPolicy Bypass -File tools\scopes\build.ps1 -Stage "C:\temp\RFP Scopes"
param([Parameter(Mandatory = $true)][string]$Stage)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent $here)
$wv = Join-Path $root 'tools\launcher\webview2'

$csc = $null
foreach ($c in @((Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'), "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe")) { if ($c -and (Test-Path $c)) { $csc = $c; break } }
if (-not $csc) { throw 'The C# compiler of .NET Framework 4 was not found.' }

if (-not ((Test-Path (Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll')) -and (Test-Path (Join-Path $wv 'x64\WebView2Loader.dll')))) {
  Write-Host 'Fetching the WebView2 SDK from nuget.org ...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $idx = Invoke-RestMethod -UseBasicParsing 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json' -TimeoutSec 30
  $ver = @($idx.versions | Where-Object { $_ -notmatch '-' })[-1]
  $tmp = Join-Path $env:TEMP ('rfp-wv2-' + [Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $tmp | Out-Null
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$ver/microsoft.web.webview2.$ver.nupkg" -OutFile (Join-Path $tmp 'p.zip') -TimeoutSec 120
  Expand-Archive -Path (Join-Path $tmp 'p.zip') -DestinationPath (Join-Path $tmp 'pkg') -Force
  $lib = Get-ChildItem (Join-Path $tmp 'pkg\lib') -Directory | Where-Object { $_.Name -match '^net4' } | Sort-Object Name -Descending | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $wv | Out-Null
  foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll') { Copy-Item (Join-Path $lib.FullName $f) $wv -Force }
  foreach ($a in 'x64', 'x86', 'arm64') { $n = Join-Path $tmp "pkg\runtimes\win-$a\native\WebView2Loader.dll"; if (Test-Path $n) { New-Item -ItemType Directory -Force -Path (Join-Path $wv $a) | Out-Null; Copy-Item $n (Join-Path $wv $a) -Force } }
  Set-Content -Path (Join-Path $wv 'VERSION.txt') -Value "Microsoft.Web.WebView2 $ver (nuget.org)"
}

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
$exe = Join-Path $Stage 'RFP Scopes.exe'
$ico = Join-Path $root 'tools\launcher\rfp.ico'
Write-Host "Building $exe ..."
& $csc /nologo /target:winexe /optimize+ /unsafe /platform:x64 "/out:$exe" "/win32icon:$ico" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
  ('/r:' + (Join-Path $wv 'Microsoft.Web.WebView2.Core.dll')) ('/r:' + (Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll')) (Join-Path $here 'RFPScopes.cs')
if ($LASTEXITCODE -ne 0) { throw 'Building RFP Scopes.exe failed (see above).' }

# the WebView2 parts: the two assemblies next to the exe, the loaders in webview2\<arch>
foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll') { Copy-Item (Join-Path $wv $f) $Stage }
foreach ($a in 'x64', 'arm64') { if (Test-Path (Join-Path $wv "$a\WebView2Loader.dll")) { New-Item -ItemType Directory -Force -Path (Join-Path $Stage "webview2\$a") | Out-Null; Copy-Item (Join-Path $wv "$a\WebView2Loader.dll") (Join-Path $Stage "webview2\$a") } }
Copy-Item (Join-Path $here 'VERSION') $Stage

# the screen: the same files as RFP Manager's /scopes
$app = Join-Path $Stage 'app'
$files = @('scopes.html', 'js\scopes.js', 'js\scopes-worklet.js', 'js\vendor\hls.min.js', 'sharing\cloudstore.css', 'brand\rfp-logo-sm.png', 'icons\favicon-64.png')
foreach ($f in $files) { $d = Join-Path $app $f; New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null; Copy-Item (Join-Path $root "public\$f") $d }
New-Item -ItemType Directory -Force -Path (Join-Path $app 'fonts') | Out-Null
Copy-Item (Join-Path $root 'public\fonts\*') (Join-Path $app 'fonts')
Set-Content -Path (Join-Path $Stage 'README.txt') -Value @"
RFP Scopes $(Get-Content (Join-Path $here 'VERSION'))  -  a broadcast monitor with scopes (RegemarkFP)

Start "RFP Scopes.exe". Choose an NDI source (or a capture card / camera) at the top: a big picture with the audio
meters beside it and the waveform, vectorscope and phase below, and a verdict: READY TO GO LIVE / ALMOST / NOT READY.
Double-click the picture for the picture alone (Esc to come back). "+ Window" (or Ctrl+N) opens another monitor.

NDI needs the NDI Runtime: install NDI Tools (free) from https://ndi.video/tools/ . Tally: "Tally..." -> by hand, or
from RFP Manager (its ATEM's program / preview input).
Needs Windows 10 or 11 (64-bit) with the Microsoft Edge WebView2 Runtime (part of Windows).
"@
Write-Host "RFP Scopes is in $Stage"
