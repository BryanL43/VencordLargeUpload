#!/bin/bash

URL="https://github.com/BryanL43/VencordLargeUpload/releases/latest/download/dist.zip"
APPDATA="$HOME/.config/Vencord"
DOWNLOAD_PATH="$APPDATA/dist.zip"
EXTRACT_PATH="$APPDATA/dist"
ETAG_FILE="$APPDATA/etag.txt"

mkdir -p "$EXTRACT_PATH"
chmod u+rw "$ETAG_FILE"

# Wait for internet connection
while ! ping -c1 github.com &>/dev/null; do
    echo "Waiting for internet connection..."
    sleep 5
done

# Get the current remote ETag
ETAG=$(curl -sIL "$URL" | grep -i ETag | tail -n1 | cut -d' ' -f2 | tr -d '\r"')

# Compare with stored ETag
if [[ "$ETAG" != "" && "$ETAG" != "$(cat "$ETAG_FILE" 2>/dev/null)" ]]; then
    # Download the latest dist.zip
    if curl -fsSL "$URL" -o "$DOWNLOAD_PATH"; then
        # Remove old dist folder
        rm -rf "$EXTRACT_PATH"

        #  Extract the zip
        unzip -q "$DOWNLOAD_PATH" -d "$EXTRACT_PATH"

        # Save the new ETag
        echo "$ETAG" > "$ETAG_FILE"

        # Delete the downloaded dist.zip
        rm -f "$DOWNLOAD_PATH"
    else
        echo "Download failed. Skipping update."
    fi
fi
