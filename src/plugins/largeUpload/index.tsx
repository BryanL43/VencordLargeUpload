/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { OpenExternalIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { CommandArgument, CommandContext, Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { DraftType, FluxDispatcher, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, showToast, Toasts, UploadManager } from "@webpack/common";

const Native = VencordNative.pluginHelpers.LargeFileUpload as PluginNative<typeof import("./native")>;

const UploadStore = findByPropsLazy("getUploads");
const OptionClasses = findByPropsLazy("optionName", "optionIcon", "optionLabel");
const cancelAbort = new Map<string, boolean>();
const cancelControllers = new Map<string, AbortController>();

interface ObserverRefs {
    current: MutationObserver;
    persistCleanup: () => void;
}

const settings = definePluginSettings({
    automaticallySendUploadsToChat: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Whether to automatically send the links with the uploaded files to chat instead of just pasting them into the chatbox.",
    }
});

function sendTextToChat(text: string, channelId?: string) {
    if (settings.store.automaticallySendUploadsToChat) {
        const targetChannelId = channelId ?? SelectedChannelStore.getChannelId();
        sendMessage(targetChannelId, { content: text });
    } else {
        insertTextIntoChatInputBox(text);
    }
}

async function resolveFile(options: CommandArgument[], ctx: CommandContext): Promise<File | null> {
    for (const opt of options) {
        if (opt.name === "file") {
            const upload = UploadStore.getUpload(ctx.channel.id, opt.name, DraftType.SlashCommand);
            return upload.item.file;
        }
    }
    return null;
}

function injectCancelButtonIntoAccessories(messageId: string, onCancel: () => void) {
    // Injects a hover style for all the cancel buttons
    if (!document.getElementById("cancel-upload-style")) {
        const style = document.createElement("style");
        style.id = "cancel-upload-style";
        style.textContent = `
            button[id^="cancel-upload-"]:hover {
                background-color: #d33939 !important;
            }
            button[id^="cancel-upload-"]:hover .trash-icon {
                stroke: #d33939 !important;
            }
        `;
        document.head.appendChild(style);
    }

    const container = document.getElementById(`message-accessories-${messageId}`);
    if (!container) return;

    const article = container.querySelector("article");
    if (!article) return;

    const button = document.createElement("button");
    button.id = `cancel-upload-${messageId}`;
    button.onclick = () => {
        onCancel();
    };

    // Style outer button
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.padding = "0";
    button.style.backgroundColor = "#ED4245";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "8px 5px 5px 8px";
    button.style.cursor = "pointer";
    button.style.fontSize = "13px";
    button.style.height = "80%";
    button.style.margin = "auto 0";

    // Icon section
    const iconSpan = document.createElement("span");
    iconSpan.innerHTML = `
        <svg class="trash-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ED4245"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="width: 20px; height: 20px;">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
        <path d="M9 6V4h6v2"></path>
        </svg>
    `;
    iconSpan.style.backgroundColor = "#2C2F33";
    iconSpan.style.padding = "5px";
    iconSpan.style.display = "flex";
    iconSpan.style.alignItems = "center";
    iconSpan.style.justifyContent = "center";
    iconSpan.style.borderRadius = "5px 0 0 5px";

    // Label section
    const labelSpan = document.createElement("span");
    labelSpan.textContent = "Cancel";
    labelSpan.style.padding = "10px 20px";

    // Assemble button
    button.appendChild(iconSpan);
    button.appendChild(labelSpan);

    // Insert after <article>
    article.insertAdjacentElement("afterend", button);
}

// Injects the cancel button into the message accessories
function waitForMessageAccessories(messageId: string, onCancel: () => void): MutationObserver {
    const accessoriesId = `message-accessories-${messageId}`;

    const tryInject = () => {
        const container = document.getElementById(accessoriesId);
        if (container) {
            // Avoid injecting twice
            if (!document.getElementById(`cancel-upload-${messageId}`)) {
                injectCancelButtonIntoAccessories(messageId, onCancel);
            }
        }
    };

    const observer = new MutationObserver(() => tryInject());

    // Try immediately in case it already exists
    tryInject();

    // Observe for changes if it's not there yet
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    return observer;
}

function watchAndPersistButton(messageId: string) {
    const accessoriesId = `message-accessories-${messageId}`;
    let positionObserver: MutationObserver | null = null;
    let presenceObserver: MutationObserver | null = null;

    // Wait until the accessories container exists;
    // When the channel is switched, it removes it, so we need to wait until it re-appears.
    const waitForContainer = () => {
        return new Promise<HTMLElement>(resolve => {
            const existing = document.getElementById(accessoriesId);
            if (existing) return resolve(existing);

            const rootObserver = new MutationObserver(() => {
                const found = document.getElementById(accessoriesId);
                if (found) {
                    rootObserver.disconnect();
                    resolve(found);
                }
            });

            rootObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    };

    // Ensure the cancel button is in the correct position, after the article.
    // The DOM elements will be shifted when MESSAGE_UPDATE is fired.
    const ensureCorrectPosition = (container: HTMLElement) => {
        positionObserver = new MutationObserver(() => {
            const article = container.querySelector("article");
            const button = document.getElementById(`cancel-upload-${messageId}`);
            if (article && button && article.nextElementSibling !== button) {
                article.insertAdjacentElement("afterend", button);
            }
        });

        positionObserver.observe(container, {
            childList: true,
            subtree: false
        });
    };

    // Locks the cancel button in place; prevents jittering.
    const loop = async () => {
        while (true) {
            const container = await waitForContainer();
            ensureCorrectPosition(container);

            await new Promise(resolve => {
                presenceObserver = new MutationObserver((_muts, obs) => {
                    if (!document.body.contains(container)) {
                        obs.disconnect();
                        resolve(null);
                    }
                });

                presenceObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            });
        }
    };

    loop();

    return () => {
        positionObserver?.disconnect();
        presenceObserver?.disconnect();
    };
}

async function dispatchCancel(
    channelId: string,
    botMessageId: string,
    observerRef: ObserverRefs,
    cancelId,
    uploadId?: string,
    fileKey?: string
) {
    // Clean up resources early to prevent UI glitching
    UploadManager.clearAll(channelId, DraftType.SlashCommand);
    observerRef.current.disconnect();
    observerRef.persistCleanup();

    // Force remove the cancel button
    const button = document.getElementById(`cancel-upload-${botMessageId}`);
    button?.remove();

    // Abort the controller
    const controller = cancelControllers.get(cancelId);
    if (controller) {
        controller.abort();
        cancelControllers.delete(cancelId);
        Native.deleteCancelController(cancelId);
    }

    // Update bot message to cancelling state
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        channelId,
        message: {
            id: botMessageId,
            channel_id: channelId,
            embeds: [
                {
                    title: "❌ Cancelling...",
                    description: "Attempting to cancel upload.",
                    color: 0xFF0000,
                    type: "rich"
                }
            ]
        }
    });

    // Dispatch a abortion request to the server
    if (uploadId && fileKey) {
        await new Promise(res => setTimeout(res, 1000));
        await Native.cancelUpload(
            "https://api.largeupload.cloud/cancel-upload",
            uploadId,
            fileKey
        );
    }

    // Update bot message to successfully canceled state
    FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        channelId,
        message: {
            id: botMessageId,
            channel_id: channelId,
            embeds: [
                {
                    title: "ℹ️  Upload Canceled!",
                    description: "Successfully cancelled upload.",
                    color: 0x2196F3,
                    type: "rich"
                }
            ]
        }
    });

    cancelAbort.delete(cancelId);
}

async function runWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number
): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = [];
    let index = 0;

    const workers = Array(concurrency).fill(null).map(async () => {
        while (index < tasks.length) {
            const currentIndex = index++;
            const task = tasks[currentIndex];
            try {
                const value = await task();
                results[currentIndex] = { status: "fulfilled", value };
            } catch (reason) {
                results[currentIndex] = { status: "rejected", reason };
            }
        }
    });

    await Promise.all(workers);
    return results;
}

async function uploadFile(
    file: File,
    channelId: string,
    botMessage: Message,
    cancelId: string,
    observerRefs: ObserverRefs
) {
    try {
        // Precheck if upload was cancelled early
        if (cancelAbort.get(cancelId)) {
            dispatchCancel(channelId, botMessage.id, observerRefs, cancelId);
            return;
        }

        const fileName = file.name;
        const fileSize = file.size;
        const fileType = file.type;

        // Request presigned URLs and upload parameters from backend
        const { uploadId, fileKey, partSize, presignedUrls } =
            await Native.promptPresignedURL(
                "https://api.largeupload.cloud/generate-upload",
                fileName,
                fileSize,
                fileType
            );

        // Cancel check
        if (cancelAbort.get(cancelId)) {
            dispatchCancel(channelId, botMessage.id, observerRefs, cancelId, uploadId, fileKey);
            return;
        }

        const totalParts = presignedUrls.length;
        let completedParts = 0;

        const controller = new AbortController();
        cancelControllers.set(cancelId, controller);
        Native.registerCancelController(cancelId, controller);

        // Concurrently upload sliced file buffers; multiple cancel check points to avoid race conditions
        const tasks = presignedUrls.map(({ partNumber, url }) => {
            return async () => {
                if (cancelAbort.get(cancelId)) {
                    return;
                }

                const start = (partNumber - 1) * partSize;
                const end = Math.min(start + partSize, file.size);
                const blobSlice = file.slice(start, end);
                const chunkBuffer = await blobSlice.arrayBuffer();

                if (cancelAbort.get(cancelId)) {
                    return;
                }

                // Upload the part and acquire its eTag
                const eTag = await Native.uploadChunkToS3(
                    url,
                    chunkBuffer,
                    fileType,
                    cancelId
                );

                if (cancelAbort.get(cancelId)) {
                    return;
                }

                completedParts++;
                const percent = Math.round((completedParts / totalParts) * 100);
                const progressBar = `[${"█".repeat(percent / 10)}${"-".repeat(10 - percent / 10)}]`;

                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    channelId,
                    message: {
                        id: botMessage.id,
                        channel_id: channelId,
                        embeds: [
                            {
                                title: `📤  Uploading Your File... [${percent}%]`,
                                description: `Progress: ${progressBar} ${percent}%`,
                                color: 0x57F287,
                                type: "rich"
                            }
                        ]
                    }
                });

                return {
                    PartNumber: partNumber,
                    ETag: eTag
                };
            };
        });

        let taskResults: PromiseSettledResult<{ PartNumber: number, ETag: string; }>[] = [];

        // Upload 20 parts concurrently if the file is less than 1GB, or 10 parts otherwise
        const taskPromise = runWithConcurrencyLimit(tasks, fileSize < 1 * 1024 * 1024 * 1024 ? 20 : 10)
            .then(results => {
                taskResults = results as PromiseSettledResult<{ PartNumber: number; ETag: string; }>[];
            })
            .finally(() => {
                clearInterval(interval);
            });

        let interval: NodeJS.Timeout;
        const cancelWatcher = new Promise<void>(resolve => {
            interval = setInterval(() => {
                if (cancelAbort.get(cancelId)) {
                    clearInterval(interval);
                    dispatchCancel(channelId, botMessage.id, observerRefs, cancelId, uploadId, fileKey);
                    resolve();
                }
            }, 100);
        });

        await Promise.race([taskPromise, cancelWatcher]);

        // Fallback check, it should've been cancelled already
        if (cancelAbort.get(cancelId)) return;

        // Filter successful uploads
        const eTags = taskResults
            .filter(res => res.status === "fulfilled")
            .map(res => (res as PromiseFulfilledResult<{ PartNumber: number, ETag: string; }>).value);

        taskResults = [];

        // Complete the upload (Lambda reassembles all uploaded parts)
        const completeUploadResponse = await Native.completeUpload(
            "https://api.largeupload.cloud/complete-upload",
            uploadId,
            fileKey,
            eTags,
            fileName,
            fileSize,
            fileType
        );

        // Send success message
        if (completeUploadResponse.embedUrl) {
            setTimeout(() => sendTextToChat(`${completeUploadResponse.embedUrl} `, channelId), 10);
            showToast("SUCCESS: File Upload Completed!", Toasts.Type.SUCCESS);
            FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId,
                id: botMessage.id
            });

            // Clean up resources
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
            observerRefs.current.disconnect();
            observerRefs.persistCleanup();
        } else {
            console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", completeUploadResponse.message);
            showToast("ERROR: File Upload Failed!", Toasts.Type.FAILURE);
            sendBotMessage(channelId, {
                embeds: [
                    {
                        title: "❌ ERROR: File Upload Failed!",
                        description: "Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN.",
                        // @ts-expect-error
                        color: 0xFF0000,
                        type: "rich"
                    }
                ]
            });
            FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId,
                id: botMessage.id
            });

            // Clean up resources
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
            observerRefs.current.disconnect();
            observerRefs.persistCleanup();
        }
    } catch (error) {
        console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", error);
        showToast("ERROR: File Upload Failed!", Toasts.Type.FAILURE);
        sendBotMessage(channelId, {
            embeds: [
                {
                    title: "❌ ERROR: File Upload Failed!",
                    description: "Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN.",
                    // @ts-expect-error
                    color: 0xFF0000,
                    type: "rich"
                }
            ]
        });
        FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            channelId,
            id: botMessage.id
        });

        // Clean up resources
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
        observerRefs.current.disconnect();
        observerRefs.persistCleanup();
    }
}

function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target && target.files && target.files.length > 0) {
            const file = target.files[0];
            if (!file) {
                showToast("No file selected");
                return;
            }

            if (file.size < 10 * 1024 * 1024) {
                showToast("⚠️ WARNING: File Too Small!", Toasts.Type.MESSAGE);
                sendBotMessage(SelectedChannelStore.getChannelId(), {
                    embeds: [
                        {
                            title: "⚠️ WARNING: File Too Small!",
                            description: "Please use Discord's regular file upload instead to save resources.",
                            // @ts-expect-error
                            color: 0xFFFF00,
                            type: "rich"
                        }
                    ]
                });
                return;
            }

            if (file.size > 2 * 1024 * 1024 * 1024) {
                showToast("⚠️ WARNING: File Too Large!", Toasts.Type.MESSAGE);
                sendBotMessage(SelectedChannelStore.getChannelId(), {
                    embeds: [
                        {
                            title: "⚠️ WARNING: File Too Large!",
                            description: "The limit is 2GB file to save resources.",
                            // @ts-expect-error
                            color: 0xFFFF00,
                            type: "rich"
                        }
                    ]
                });
                return;
            }

            const channelId = SelectedChannelStore.getChannelId();
            const cancelId = `cancel_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const botMessage = await sendBotMessage(channelId, {
                embeds: [
                    {
                        title: "📤  Uploading Your File...",
                        description: "This might take a moment.",
                        // @ts-expect-error
                        color: 0x57F287,
                        type: "rich"
                    }
                ]
            });

            // Set initial state of abortion
            cancelAbort.set(cancelId, false);

            // Latch a persistent cancel button to the bot message
            const observerRefs: ObserverRefs = {
                current: waitForMessageAccessories(botMessage.id, () => {
                    cancelAbort.set(cancelId, true);
                    console.log("Upload cancel request for:", botMessage.id);
                }),
                persistCleanup: watchAndPersistButton(botMessage.id)
            };

            await uploadFile(file, channelId, botMessage, cancelId, observerRefs);
        }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

const ctxMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (props.channel.guild_id && !PermissionStore.can(PermissionsBits.SEND_MESSAGES, props.channel)) return;

    children.splice(1, 0,
        <Menu.MenuItem
            id="upload-large-file"
            label={
                <div className={OptionClasses.optionLabel}>
                    <OpenExternalIcon className={OptionClasses.optionIcon} height={24} width={24} />
                    <div className={OptionClasses.optionName}>Upload a Large File</div>
                </div>
            }
            action={triggerFileUpload}
        />
    );
};

export default definePlugin({
    name: "LargeFileUpload",
    description: "Bypass Discord's upload limit by uploading files using the 'Upload a Large File' button or /fileupload and they'll get uploaded as links into the chat. The file upload size is limited to the range of 10MB to 2GB for resource efficiency.",
    authors: [Devs.bryan],
    settings,
    dependencies: ["CommandsAPI"],
    contextMenus: {
        "channel-attach": ctxMenuPatch,
    },
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "fileupload",
            description: "Upload a file",
            options: [
                {
                    name: "file",
                    description: "The file to upload",
                    type: ApplicationCommandOptionType.ATTACHMENT,
                    required: true,
                },
            ],
            execute: async (opts, cmdCtx) => {
                const channelId = cmdCtx.channel.id;
                const file = await resolveFile(opts, cmdCtx);
                if (!file) {
                    showToast("No file specified");
                    sendBotMessage(channelId, { content: "No file specified!" });
                    UploadManager.clearAll(channelId, DraftType.SlashCommand);
                    return;
                }

                if (file.size < 10 * 1024 * 1024) {
                    showToast("⚠️ WARNING: File Too Small!", Toasts.Type.MESSAGE);
                    sendBotMessage(channelId, {
                        embeds: [
                            {
                                title: "⚠️ WARNING: File Too Small!",
                                description: "Please use Discord's regular file upload instead to save resources.",
                                // @ts-expect-error
                                color: 0xFFFF00,
                                type: "rich"
                            }
                        ]
                    });
                    return;
                }

                if (file.size > 2 * 1024 * 1024 * 1024) {
                    showToast("⚠️ WARNING: File Too Large!", Toasts.Type.MESSAGE);
                    sendBotMessage(channelId, {
                        embeds: [
                            {
                                title: "⚠️ WARNING: File Too Large!",
                                description: "The limit is 2GB file to save resources.",
                                // @ts-expect-error
                                color: 0xFFFF00,
                                type: "rich"
                            }
                        ]
                    });
                    return;
                }

                const cancelId = `cancel_upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const botMessage = await sendBotMessage(channelId, {
                    embeds: [
                        {
                            title: "📤  Uploading Your File...",
                            description: "This might take a moment.",
                            // @ts-expect-error
                            color: 0x57F287,
                            type: "rich"
                        }
                    ]
                });

                // Set initial state of abortion
                cancelAbort.set(cancelId, false);

                // Latch a persistent cancel button to the bot message
                const observerRefs: ObserverRefs = {
                    current: waitForMessageAccessories(botMessage.id, () => {
                        cancelAbort.set(cancelId, true);
                        console.log("Upload cancel request for:", botMessage.id);
                    }),
                    persistCleanup: watchAndPersistButton(botMessage.id)
                };

                // Launch upload as a seperate thread to prevent UI blocking
                setTimeout(() => {
                    uploadFile(file, channelId, botMessage, cancelId, observerRefs);
                }, 0);
            },
        },
    ],
});
