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
import { DraftType, FluxDispatcher, Forms, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, showToast, Switch, Toasts, UploadManager } from "@webpack/common";

const Native = VencordNative.pluginHelpers.LargeFileUpload as PluginNative<typeof import("./native")>;

const UploadStore = findByPropsLazy("getUploads");
const OptionClasses = findByPropsLazy("optionName", "optionIcon", "optionLabel");

function SettingsComponent(props: { setValue(v: any): void; }) {
    function updateSetting(key: keyof typeof settings.store, value: any) {
        if (key in settings.store) {
            (settings.store as any)[key] = value;
        } else {
            console.error(`Invalid setting key: ${key}`);
        }
    }

    return (
        <Forms.FormSection>
            <Switch
                value={settings.store.autoSend === "Yes"}
                onChange={(enabled: boolean) => updateSetting("autoSend", enabled ? "Yes" : "No")}
                note="Whether to automatically send the links with the uploaded files to chat instead of just pasting them into the chatbox."
                hideBorder={true}
            >
                Auto-Send Uploads To Chat
            </Switch>
        </Forms.FormSection>
    );
}

const settings = definePluginSettings({
    autoSend: {
        type: OptionType.SELECT,
        options: [
            { label: "Yes", value: "Yes", default: true },
            { label: "No", value: "No" },
        ],
        description: "Auto-Send",
        hidden: true
    },
    customSettings: {
        type: OptionType.COMPONENT,
        component: SettingsComponent,
        description: "Configure custom uploader settings",
        hidden: false
    }
});

function sendTextToChat(text: string, channelId?: string) {
    if (settings.store.autoSend === "No") {
        insertTextIntoChatInputBox(text);
    } else {
        const targetChannelId = channelId ?? SelectedChannelStore.getChannelId();
        sendMessage(targetChannelId, { content: text });
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

async function uploadFile(file: File, channelId: string, botMessage: Message) {
    try {
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

        const totalParts = presignedUrls.length;
        let completedParts = 0;

        // Concurrently upload sliced file buffers
        const tasks = presignedUrls.map(({ partNumber, url }) => {
            return async () => {
                // Compute the buffer for the individual part
                const start = (partNumber - 1) * partSize;
                const end = Math.min(start + partSize, file.size);

                const blobSlice = file.slice(start, end);
                const chunkBuffer = await blobSlice.arrayBuffer();

                // Upload the part and acquire its eTag
                const eTag = await Native.uploadChunkToS3(
                    url,
                    chunkBuffer,
                    fileType
                );

                // Update the progress bar
                completedParts++;
                const percent = Math.round((completedParts / totalParts) * 100);
                const progressBar = `[${"█".repeat(percent / 10)}${"-".repeat(10 - percent / 10)}]`;

                // Update the progress bar embed message
                FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    channelId,
                    message: {
                        id: botMessage.id,
                        channel_id: channelId,
                        embeds: [
                            {
                                title: `📤 Uploading File... [${percent}%]`,
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

        // Upload 20 parts concurrently if the file is less than 1GB, or 10 parts otherwise
        const eTags = await runWithConcurrencyLimit(tasks, fileSize < 1 * 1024 * 1024 * 1024 ? 20 : 10);

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
        if (completeUploadResponse !== undefined) {
            setTimeout(() => sendTextToChat(`${completeUploadResponse.embedUrl} `, channelId), 10);
            showToast("SUCCESS: File Upload Completed!", Toasts.Type.SUCCESS);
            FluxDispatcher.dispatch({
                type: "MESSAGE_DELETE",
                channelId,
                id: botMessage.id
            });
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
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
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
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
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
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
            const botMessage = sendBotMessage(channelId, {
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
            await uploadFile(file, channelId, botMessage);
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
    description: "Bypass Discord's upload limit by uploading files using the 'Upload a Big File' button or /fileupload and they'll get uploaded as links into chat via file uploaders. The file upload size is limited to the range of 10MB to 2GB for resource efficiency.",
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

                const botMessage = sendBotMessage(channelId, {
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

                await uploadFile(file, channelId, botMessage);
            },
        },
    ],
});
