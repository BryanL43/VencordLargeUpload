# This script runs at Windows startup to keep Vencord updated.

$URL = "https://github.com/BryanL43/VencordLargeUpload/releases/latest/download/dist.zip"
$DownloadPath = "$env:APPDATA\Vencord\dist.zip"
$ExtractPath = "$env:APPDATA\Vencord\dist"
$ETagPath = "$env:APPDATA\Vencord\etag.txt"

# Wait until internet is connected
$Online = $false
while (-not $Online) {
    try {
        # Test with a HEAD request to GitHub
        Invoke-WebRequest -Uri "https://github.com" -Method Head -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $Online = $true
    }
    catch {
        # Still offline. Wait and try again.
        Start-Sleep -Seconds 5
    }
}

try {
    # Get the ETag of the latest dist.zip
    $Response = Invoke-WebRequest -Uri $URL -Method Head -UseBasicParsing
    $ETag = $Response.Headers["ETag"]
    $StoredETag = ""

    # Acquire stored ETag
    if (Test-Path $ETagPath) {
        $StoredETag = Get-Content $ETagPath -Raw
    }

    if ($ETag -ne $StoredETag) {
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

        # Save the new ETag
        Set-Content -Path $ETagPath -Value $ETag
    }
} catch {
    # Silently ignore errors so startup doesn't bother the user
}
