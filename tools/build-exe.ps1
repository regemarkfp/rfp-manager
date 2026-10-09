# Builds "RFP Manager.exe" in the RFP Manager folder, with the C# compiler that comes with Windows (.NET Framework 4).
# Nothing is downloaded. Run it again after updating RFP Manager to a new zip (or just keep the old exe: it still works).
#   powershell -ExecutionPolicy Bypass -File tools\build-exe.ps1            (or double-click "Build RFP Manager app.cmd")
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $PSScriptRoot 'launcher\RFPManager.cs'
$ico = Join-Path $PSScriptRoot 'launcher\rfp.ico'
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

Write-Host "Building $out ..."
& $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$out" "/win32icon:$ico" /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll $src
if ($LASTEXITCODE -ne 0) { Write-Host 'Building failed (see above).' -ForegroundColor Red; exit 1 }

# shortcuts on the desktop and in the Start menu
$ws = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $l = $ws.CreateShortcut((Join-Path $folder 'RFP Manager.lnk'))
  $l.TargetPath = $out; $l.WorkingDirectory = $root; $l.IconLocation = "$out,0"; $l.Description = 'RFP Manager'
  $l.Save()
}
Write-Host ''
Write-Host 'Done: "RFP Manager.exe" is in the RFP Manager folder, with shortcuts on the desktop and in the Start menu.' -ForegroundColor Green
Write-Host 'Start it from there. It runs RFP Manager without a console window and puts an icon in the tray (bottom right).'
