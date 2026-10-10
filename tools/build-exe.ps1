# Builds "RFP Manager.exe" in the RFP Manager folder, with the C# compiler that comes with Windows (.NET Framework 4).
# RFP Manager.exe shows RFP Manager in its own windows with WebView2 (the engine of Microsoft Edge, already on
# Windows 10 and 11). The first build fetches the WebView2 SDK (about 10 MB, from nuget.org, Microsoft's package site)
# into tools\launcher\webview2; later builds use that copy. Without internet the exe is built without it and opens
# windows in Edge / Chrome app mode instead.
#   powershell -ExecutionPolicy Bypass -File tools\build-exe.ps1            (or double-click "Build RFP Manager app.cmd")
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'launcher\RFPManager.cs'
$ico = Join-Path $PSScriptRoot 'launcher\rfp.ico'
$wv = Join-Path $PSScriptRoot 'launcher\webview2'
$out = Join-Path $root 'RFP Manager.exe'

$csc = $null
foreach ($c in @(
    (Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'),
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe")) { if ($c -and (Test-Path $c)) { $csc = $c; break } }
if (-not $csc) { Write-Host 'The C# compiler of .NET Framework 4 was not found (it comes with Windows 10 and 11).' -ForegroundColor Red; exit 1 }

# a running RFP Manager.exe holds the file: ask it to close first
$running = Get-Process -Name 'RFP Manager' -ErrorAction SilentlyContinue
if ($running) { Write-Host 'Close RFP Manager (tray icon -> Quit) and run this again.' -ForegroundColor Yellow; exit 1 }

# ---- the WebView2 SDK (once)
function Get-WebView2 {
  if ((Test-Path (Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll')) -and (Test-Path (Join-Path $wv 'x64\WebView2Loader.dll'))) { return $true }
  Write-Host 'Fetching the WebView2 SDK from nuget.org (once) ...'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $ver = '1.0.2903.40'
    try {
      $idx = Invoke-RestMethod -UseBasicParsing 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/index.json' -TimeoutSec 30
      $stable = @($idx.versions | Where-Object { $_ -notmatch '-' })
      if ($stable.Count) { $ver = $stable[-1] }
    } catch { Write-Host "  (could not list versions, using $ver)" }
    $tmp = Join-Path $env:TEMP ('rfp-webview2-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'webview2.zip'
    Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$ver/microsoft.web.webview2.$ver.nupkg" -OutFile $zip -TimeoutSec 120
    Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'pkg') -Force
    $lib = Get-ChildItem (Join-Path $tmp 'pkg\lib') -Directory | Where-Object { $_.Name -match '^net4' } | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $lib) { throw 'no .NET Framework assemblies in the package' }
    New-Item -ItemType Directory -Force -Path $wv | Out-Null
    foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll') { Copy-Item (Join-Path $lib.FullName $f) $wv -Force }
    foreach ($a in 'x64', 'x86', 'arm64') {
      $n = Join-Path $tmp "pkg\runtimes\win-$a\native\WebView2Loader.dll"
      if (Test-Path $n) { New-Item -ItemType Directory -Force -Path (Join-Path $wv $a) | Out-Null; Copy-Item $n (Join-Path $wv $a) -Force }
    }
    Get-ChildItem $wv -Recurse -File | Unblock-File
    Set-Content -Path (Join-Path $wv 'VERSION.txt') -Value "Microsoft.Web.WebView2 $ver (nuget.org). Licence: https://www.nuget.org/packages/Microsoft.Web.WebView2/$ver/License"
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  WebView2 SDK $ver is in tools\launcher\webview2"
    return $true
  } catch {
    Write-Host ("  Could not fetch it: " + $_.Exception.Message) -ForegroundColor Yellow
    Write-Host '  RFP Manager.exe is built without it: windows open in Edge / Chrome app mode. Run this again with internet to fix that.' -ForegroundColor Yellow
    return $false
  }
}
$hasWv = Get-WebView2

Write-Host "Building $out ..."
$refs = @('/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll')
if ($hasWv) { $refs += @('/define:WEBVIEW2', ('/r:' + (Join-Path $wv 'Microsoft.Web.WebView2.Core.dll')), ('/r:' + (Join-Path $wv 'Microsoft.Web.WebView2.WinForms.dll'))) }
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$out" "/win32icon:$ico" @refs $src
if ($LASTEXITCODE -ne 0 -and $hasWv) {
  Write-Host 'Building with WebView2 failed (see above); building the Edge / Chrome version instead.' -ForegroundColor Yellow
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$out" "/win32icon:$ico" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll $src
}
if ($LASTEXITCODE -ne 0) { Write-Host 'Building failed (see above).' -ForegroundColor Red; exit 1 }

# the WebView2 Runtime (part of Windows 10 / 11 with Edge); offer the installer when it is missing
if ($hasWv) {
  $rt = @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') | Where-Object { Test-Path $_ }
  if (-not $rt) { Write-Host 'The Microsoft Edge WebView2 Runtime seems to be missing. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 (RFP Manager uses Edge / Chrome windows until then).' -ForegroundColor Yellow }
}

# shortcuts on the desktop and in the Start menu
$ws = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $l = $ws.CreateShortcut((Join-Path $folder 'RFP Manager.lnk'))
  $l.TargetPath = $out; $l.WorkingDirectory = $root; $l.IconLocation = "$out,0"; $l.Description = 'RFP Manager'
  $l.Save()
}
Write-Host ''
Write-Host 'Done: "RFP Manager.exe" is in the RFP Manager folder, with shortcuts on the desktop and in the Start menu.' -ForegroundColor Green
if ($hasWv) { Write-Host 'Start it from there. RFP Manager opens in its own window (no browser), with an icon in the tray (bottom right).' }
else { Write-Host 'Start it from there. It runs RFP Manager without a console window and puts an icon in the tray (bottom right).' }
