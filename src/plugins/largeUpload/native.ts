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

async function runWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number
): Promise<T[]> {
    const results: T[] = [];
    let index = 0;

    const workers = Array(concurrency).fill(null).map(async () => {
        while (index < tasks.length) {
            const currentIndex = index++;
            const task = tasks[currentIndex];
            results[currentIndex] = await task();
        }
    });

    await Promise.all(workers);
    return results;
}

// export async function uploadFilePartsToCloud(
//     _,
//     arrayBuffer: ArrayBuffer,
//     presignedUrls: { partNumber: number; url: string; }[],
//     contentType: string,
//     partSize: number
// ) {
//     const buffer = Buffer.from(arrayBuffer);

//     const tasks = presignedUrls.map(({ partNumber, url }) => {
//         return async () => {
//             const start = (partNumber - 1) * partSize;
//             const end = Math.min(start + partSize, buffer.length);
//             const chunk = buffer.subarray(start, end);

//             const eTag = await uploadChunkToS3(url, chunk, contentType);
//             return {
//                 PartNumber: partNumber,
//                 ETag: eTag
//             };
//         };
//     });

//     const eTags = await runWithConcurrencyLimit(tasks, 20);

//     return eTags;
// }

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
