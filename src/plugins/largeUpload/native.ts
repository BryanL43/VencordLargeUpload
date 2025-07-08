/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MultipartUploadResponse {
    uploadId: string;
    key: string;
    partSize: number;
    presignedUrls: { partNumber: number; url: string; }[];
    embedUrl: string;
}

export interface PartUploadResult {
    status: number;
    eTag: string | null;
}

export async function promptPresignedURL(
    _, url: string,
    name: string,
    fileSize: number,
    fileType: string
): Promise<MultipartUploadResponse> {
    try {
        const options: RequestInit = {
            method: "POST",
            redirect: "follow",
            body: JSON.stringify({
                "fileName": name,
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

async function uploadChunkToS3(
    url: string,
    chunk: Buffer,
    contentType: string
) {
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "Content-Type": contentType,
            "Content-Length": chunk.length.toString()
        },
        body: chunk
    });

    if (!res.ok) {
        throw new Error(`Failed with status ${res.status}`);
    }

    const eTagHeader = res.headers.get("etag");
    return eTagHeader?.replaceAll('"', "") || "";
}

export async function uploadFilePartsToCloud(
    _,
    arrayBuffer: ArrayBuffer,
    presignedUrls: { partNumber: number; url: string; }[],
    contentType: string,
    partSize: number
) {
    const buffer = Buffer.from(arrayBuffer);

    const uploadPromises = presignedUrls.map(({ partNumber, url }) => {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, buffer.length);
        const chunk = buffer.subarray(start, end);

        return uploadChunkToS3(url, chunk, contentType)
            .then(eTag => {
                return {
                    PartNumber: partNumber,
                    ETag: eTag
                };
            });
    });

    const eTags = await Promise.all(uploadPromises);

    return eTags;
}

export async function completeUpload(
    _,
    url: string,
    uploadId: string,
    key: string,
    eTags: { PartNumber: number; ETag: string; }[]
) {
    try {
        const completePayload = {
            uploadId,
            key,
            parts: eTags
        };

        const options: RequestInit = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(completePayload)
        };

        const response = await fetch(url, options);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}
