; RFP Manager for Windows – the installer (Inno Setup 6). GitHub builds it (.github/workflows/windows.yml):
;   iscc /DStage="<folder with the whole program>" /DVersion=0.1.13 tools\installer\rfp-manager.iss
; It installs for the person running it (no administrator needed) into %LOCALAPPDATA%\Programs\RFP Manager, so RFP Manager
; can keep updating itself there. Start menu shortcut, optional desktop icon, optional start with Windows, an uninstaller.
; Installing over an older RFP Manager keeps config.json, data\ and the images (the installer never touches them).

#ifndef Stage
  #error Pass /DStage=<folder>
#endif
#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{6C1C6A52-3F0B-4B5E-9C35-7E2A9C6F4D11}
AppName=RFP Manager
AppVersion={#Version}
AppVerName=RFP Manager {#Version}
AppPublisher=RegemarkFP
AppPublisherURL=https://regemarkfp.com
DefaultDirName={localappdata}\Programs\RFP Manager
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=RFPManager-Setup
SetupIconFile=..\launcher\rfp.ico
UninstallDisplayIcon={app}\RFP Manager.exe
UninstallDisplayName=RFP Manager
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
ChangesAssociations=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "A shortcut on the desktop"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start RFP Manager with Windows (graphics, scorers and notifications are ready when the PC starts)"; GroupDescription: "When Windows starts:"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "\config.json,\data\*"

[Icons]
Name: "{autoprograms}\RFP Manager"; Filename: "{app}\RFP Manager.exe"; WorkingDir: "{app}"; AppUserModelID: "RegemarkFP.RFPManager"; Comment: "Graphics, scoring, streams and productions"
Name: "{autoprograms}\RFP Manager (console)"; Filename: "{app}\node\node.exe"; Parameters: "server.js"; WorkingDir: "{app}"; Comment: "RFP Manager with its console window, for troubleshooting"
Name: "{autodesktop}\RFP Manager"; Filename: "{app}\RFP Manager.exe"; WorkingDir: "{app}"; AppUserModelID: "RegemarkFP.RFPManager"; Tasks: desktopicon

[Registry]
; the same value the tray menu's "Start with Windows" sets, so either one can switch it off
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "RFP Manager"; ValueData: """{app}\RFP Manager.exe"""; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\RFP Manager.exe"; Description: "Start RFP Manager now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM ""RFP Manager.exe"""; Flags: runhidden; RunOnceId: "StopRFP"

[UninstallDelete]
; what RFP Manager's own updates left; config.json, data\ and the images are kept unless removed by hand
Type: filesandordirs; Name: "{app}\.update-tmp"
Type: filesandordirs; Name: "{app}\.update-backup"

[Code]
// a running RFP Manager (and its node.exe) holds the files: stop it first
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM "RFP Manager.exe"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
  Result := '';
end;
