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

export async function promptPresignedURL(
    _, url: string,
    fileName: string,
    fileSize: number,
    fileType: string
): Promise<MultipartUploadResponse> {
    try {
        const options: RequestInit = {
            method: "POST",
            redirect: "follow",
            body: JSON.stringify({
                "fileName": fileName,
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

// Inject a cancel controller into Native global scope
const cancelControllers = new Map<string, AbortController>();
export function registerCancelController(_, cancelId: string, controller: AbortController) {
    cancelControllers.set(cancelId, controller);
}

export async function uploadChunkToS3(
    _,
    url: string,
    chunk: ArrayBuffer,
    contentType: string,
    cancelId: string
) {
    const controller = cancelControllers.get(cancelId);

    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "Content-Length": chunk.byteLength.toString()
        },
        body: chunk,
        signal: controller?.signal
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
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}

export async function cancelUpload(
    _,
    url: string,
    uploadId: string,
    fileKey: string
) {
    try {
        const options: RequestInit = {
            method: "POST",
            body: JSON.stringify({
                "uploadId": uploadId,
                "fileKey": fileKey
            })
        };

        const response = await fetch(url, options);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}
