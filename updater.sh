#!/bin/bash

URL="https://github.com/BryanL43/VencordLargeUpload/releases/latest/download/dist.zip"
APPDATA="$HOME/.config/Vencord"
DOWNLOAD_PATH="$APPDATA/dist.zip"
EXTRACT_PATH="$APPDATA/dist"

mkdir -p "$EXTRACT_PATH"

# Wait for internet connection
while ! ping -c1 github.com &>/dev/null; do
    echo "Waiting for internet connection..."
    sleep 5
done

# Download the latest dist.zip
if curl -fsSL "$URL" -o "$DOWNLOAD_PATH"; then
    # Remove old dist folder
    rm -rf "$EXTRACT_PATH"

    # Extract the zip
    unzip -q "$DOWNLOAD_PATH" -d "$EXTRACT_PATH"

    # Delete the downloaded dist.zip
    rm -f "$DOWNLOAD_PATH"
else
    echo "Download failed. Skipping update."
fi
