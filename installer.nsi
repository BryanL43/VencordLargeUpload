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
        'powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "$APPDATA\Vencord\updater.ps1"'

    MessageBox MB_OK "Custom Vencord build installed and injected into Discord!"

SectionEnd
