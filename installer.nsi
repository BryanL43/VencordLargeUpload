Outfile "VencordCustomInstaller.exe"
InstallDir "$APPDATA\Vencord\dist"

Section

    ; Make sure target folders exist
    CreateDirectory "$APPDATA\Vencord"
    CreateDirectory $INSTDIR

    ; Copy VencordInstallerCli.exe first
    ; from dist\Installer\VencordInstallerCli.exe
    SetOutPath "$APPDATA\Vencord"
    File dist\Installer\VencordInstallerCli.exe

    ; Copy Updater script
    File updater.ps1

    ; Copy VBScript launcher
    File LaunchUpdater.vbs

    ; Run the installer CLI with --install
    ExecWait '"$APPDATA\Vencord\VencordInstallerCli.exe" --install'

    ; Now overwrite dist with custom build
    SetOutPath $INSTDIR

    ; Copy only files in dist root
    File /nonfatal dist\*.*

    ; Register Updater at startup
    WriteRegStr HKCU \
        "Software\Microsoft\Windows\CurrentVersion\Run" \
        "VencordUpdater" \
        '"wscript.exe" "$APPDATA\Vencord\LaunchUpdater.vbs"'

    MessageBox MB_OK "Custom Vencord build installed and injected into Discord!"

SectionEnd
