# This script runs at Windows startup to keep Vencord updated.

$URL = "https://github.com/BryanL43/VencordLargeUpload/releases/latest/download/dist.zip"
$DownloadPath = "$env:APPDATA\Vencord\dist.zip"
$ExtractPath = "$env:APPDATA\Vencord\dist"

try {
    # Download the latest dist.zip
    Invoke-WebRequest -Uri $URL -OutFile $DownloadPath -UseBasicParsing

    # Unzip it into dist
    if (Test-Path $ExtractPath) {
        Remove-Item $ExtractPath -Recurse -Force
    }
    Expand-Archive -LiteralPath $DownloadPath -DestinationPath $ExtractPath -Force

    # Delete the downloaded dist.zip
    if (Test-Path $DownloadPath) {
        Remove-Item $DownloadPath -Force
    }
}
catch {
    # Silently ignore errors so startup doesn't bother the user
}
