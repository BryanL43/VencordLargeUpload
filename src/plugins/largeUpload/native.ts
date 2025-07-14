/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MultipartUploadResponse {
    uploadId: string;
    fileKey: string;
    partSize: number;
    presignedUrls: { partNumber: number; url: string; }[];
}

export interface PartUploadResult {
    status: number;
    eTag: string | null;
}

export async function promptPresignedURL(
    _, url: string,
    fileSize: number,
    fileType: string
): Promise<MultipartUploadResponse> {
    try {
        const options: RequestInit = {
            method: "POST",
            redirect: "follow",
            body: JSON.stringify({
                "fileSize": fileSize,
                "contentType": fileType
            })
        };

        const response = await fetch(url, options);
        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Server error ${response.status}: ${errorBody.message}`);
        }

        const result = await response.json();
        return result as MultipartUploadResponse;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}

export async function uploadChunkToS3(
    _,
    url: string,
    chunk: ArrayBuffer,
    contentType: string
) {
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "Content-Length": chunk.byteLength.toString()
        },
        body: chunk
    });

    if (!res.ok) {
        throw new Error(`Failed with status ${res.status}`);
    }

    const eTagHeader = res.headers.get("etag");
    return eTagHeader?.replaceAll('"', "") || "";
}

export async function completeUpload(
    _,
    url: string,
    uploadId: string,
    fileKey: string,
    eTags: { PartNumber: number; ETag: string; }[],
    fileName: string,
    fileSize: number,
    fileType: string
) {
    try {
        const options: RequestInit = {
            method: "POST",
            body: JSON.stringify({
                "uploadId": uploadId,
                "fileKey": fileKey,
                "parts": eTags,
                "fileName": fileName,
                "fileSize": fileSize,
                "contentType": fileType
            })
        };

        const response = await fetch(url, options);
        const result = await response.json();
        console.log(result);
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}
