; RFP Scopes for Windows – the installer (Inno Setup 6). GitHub builds it (.github/workflows/scopes.yml):
;   iscc /DStage="<folder made by tools\scopes\build.ps1>" /DVersion=1.0.0 tools\scopes\rfp-scopes.iss
; Installs for the person running it (no administrator needed) into %LOCALAPPDATA%\Programs\RFP Scopes.

#ifndef Stage
  #error Pass /DStage=<folder>
#endif
#ifndef Version
  #define Version "0.0.0"
#endif

[Setup]
AppId={{B3E1F6C2-7A44-4C1D-9E7B-5F2A8D0C3E91}
AppName=RFP Scopes
AppVersion={#Version}
AppVerName=RFP Scopes {#Version}
AppPublisher=RegemarkFP
AppPublisherURL=https://regemarkfp.com
DefaultDirName={localappdata}\Programs\RFP Scopes
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=RFPScopes-Setup
SetupIconFile=..\launcher\rfp.ico
UninstallDisplayIcon={app}\RFP Scopes.exe
UninstallDisplayName=RFP Scopes
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force

[Tasks]
Name: "desktopicon"; Description: "A desktop icon"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\RFP Scopes"; Filename: "{app}\RFP Scopes.exe"
Name: "{autodesktop}\RFP Scopes"; Filename: "{app}\RFP Scopes.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\RFP Scopes.exe"; Description: "Start RFP Scopes"; Flags: nowait postinstall skipifsilent
