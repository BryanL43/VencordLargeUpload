/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export async function promptPresignedURL(_, url: string) {
    try {
        const options: RequestInit = {
            method: "POST",
            redirect: "follow"
        };

        const response = await fetch(url, options);
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}

export async function uploadFileToCloud(_, url: string, fileBuffer: ArrayBuffer, fileType: string): Promise<number> {
    try {
        const options: RequestInit = {
            method: "PUT",
            headers: {
                "Content-Type": fileType
            },
            body: fileBuffer
        };

        const response = await fetch(url, options);
        const result = await response.status;
        return result;
    } catch (error) {
        console.error("Error during fetch request:", error);
        throw error;
    }
}
