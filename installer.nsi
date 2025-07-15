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

    ; Run the installer CLI with --install
    ExecWait '"$APPDATA\Vencord\VencordInstallerCli.exe" --install'

    ; Now overwrite dist with custom build
    SetOutPath $INSTDIR

    ; Copy only files in dist root
    File /nonfatal dist\*.*

    MessageBox MB_OK "Custom Vencord build installed and injected into Discord!"

SectionEnd
