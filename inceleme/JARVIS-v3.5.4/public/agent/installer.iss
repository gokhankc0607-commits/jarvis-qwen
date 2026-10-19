; Inno Setup 6 — JARVIS kurulum paketi (Setup.exe)
; Derleme:  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;           veya:  python build.py --setup      (önce --onefile)
;
; Kurallar:
;   * config.json kullanıcıya aittir  -> güncellemede EZİLMEZ (onlyifdoesntexist)
;   * veriler %APPDATA%\JARVIS'tedir  -> kurulum/kaldırma bunlara dokunmaz
;   * kaldırırken veriler korunur     -> isteğe bağlı silme sorusu sorulur
#define AppName "JARVIS"
#define PortableDir "dist\JARVIS-Portable"
#define OneDirExe "dist\JARVIS\JARVIS.exe"
#define SrcExe FileExists(PortableDir + "\JARVIS.exe") ? PortableDir + "\JARVIS.exe" : OneDirExe
#define HasExe FileExists(SrcExe)
#define AppVersion HasExe ? GetFileVersion(SrcExe) : "0.0.0"

[Setup]
AppId={{6E1B7A52-4C2D-4B7E-9A3F-1A2B3C4D5E6F}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=JARVIS
DefaultDirName={localappdata}\JARVIS
DefaultGroupName=JARVIS
PrivilegesRequired=lowest
OutputDir=dist
OutputBaseFilename=JARVIS-Setup
SetupIconFile=jarvis.ico
UninstallDisplayIcon={app}\JARVIS.exe
UninstallDisplayName={#AppName} {#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
DisableWelcomePage=no
CloseApplications=no
; Aynı anda tek kurulum
SetupMutex=JARVISInstallerMutex

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Kısayollar:"
Name: "autostart"; Description: "Windows açılışında JARVIS'i başlat"; GroupDescription: "Başlangıç:"; Flags: unchecked

#if HasExe && FileExists(PortableDir + "\JARVIS.exe")
[Files]
; TEK DOSYA sürüm: JARVIS.exe + örnek ayar + yardım. portable.txt ve veriler HARİÇ
; (kurulu sürüm verileri %APPDATA%\JARVIS'te tutar).
Source: "{#PortableDir}\*"; DestDir: "{app}"; \
    Excludes: "config.json,portable.txt,JARVIS-Data,logs,backups,.selftest.tmp"; \
    Flags: ignoreversion recursesubdirs createallsubdirs
; config.json kullanıcıya aittir — güncellemede ezilmez
Source: "{#PortableDir}\config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist skipifsourcedoesntexist
#else
[Files]
; Klasör sürümü (jarvis.spec)
Source: "dist\JARVIS\*"; DestDir: "{app}"; \
    Excludes: "config.json,portable.txt,JARVIS-Data,logs,backups"; \
    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\JARVIS\config.json"; DestDir: "{app}"; Flags: onlyifdoesntexist skipifsourcedoesntexist
#endif

[Icons]
Name: "{group}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; IconFilename: "{app}\jarvis.ico"
Name: "{group}\JARVIS Kurulum Sihirbazı"; Filename: "{app}\JARVIS.exe"; Parameters: "--setup"; WorkingDir: "{app}"
Name: "{group}\JARVIS Kendi Kendini Test"; Filename: "{app}\JARVIS.exe"; Parameters: "--selftest"; WorkingDir: "{app}"
Name: "{group}\JARVIS (sessiz mod)"; Filename: "{app}\JARVIS.exe"; Parameters: "--no-voice"; WorkingDir: "{app}"
Name: "{group}\JARVIS'i Kaldır"; Filename: "{uninstallexe}"
Name: "{autodesktop}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\JARVIS"; Filename: "{app}\JARVIS.exe"; WorkingDir: "{app}"; Tasks: autostart

[Run]
Filename: "{app}\JARVIS.exe"; Description: "JARVIS'i şimdi başlat"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
  Res: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{%APPDATA}\JARVIS');
    if DirExists(DataDir) then
    begin
      Res := MsgBox('Ayarlarınız ve veritabanınız KORUNDU:' + #13#10 +
                    DataDir + #13#10#13#10 +
                    'Bunları da silmek ister misiniz?' + #13#10 +
                    '(Hayır: JARVIS yeniden kurulduğunda aynı verilerle devam eder)',
                    mbConfirmation, MB_YESNO or MB_DEFBUTTON2);
      if Res = IDYES then
        DelTree(DataDir, True, True, True);
    end;
    { taşınabilir veri klasörü de programla aynı yerde kalmış olabilir }
    if DirExists(ExpandConstant('{app}\JARVIS-Data')) then
      DelTree(ExpandConstant('{app}\JARVIS-Data'), True, True, True);
  end;
end;
