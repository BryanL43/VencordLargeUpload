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
import { CommandArgument, CommandContext } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { DraftType, FluxDispatcher, Forms, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, showToast, Switch, Toasts, UploadManager, UserStore } from "@webpack/common";

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

async function uploadFile(file: File, channelId: string) {
    try {
        const fileName = file.name;
        const fileSize = file.size;
        const fileType = file.type;

        showToast("Uploading... This may take a moment.", Toasts.Type.MESSAGE);

        // Request presigned URLs and upload parameters from backend
        const { uploadId, fileKey, partSize, presignedUrls } =
            await Native.promptPresignedURL(
                "https://api.largeupload.cloud/generate-upload",
                fileName,
                fileSize,
                fileType
            );

        // Take the file's buffer first due to Native limitations (electron bypassing CSP)
        const arrayBuffer = await file.arrayBuffer();

        // Upload the individual parts to their respective presigned URLs
        const eTags = await Native.uploadFilePartsToCloud(
            arrayBuffer,
            presignedUrls,
            file.type,
            partSize
        );

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

        console.log(completeUploadResponse);

        // Send success message
        if (completeUploadResponse !== undefined) {
            setTimeout(() => sendTextToChat(`${completeUploadResponse.embedUrl} `, channelId), 10);
            showToast("Upload complete!", Toasts.Type.SUCCESS);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        } else {
            console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", completeUploadResponse.message);
            sendBotMessage(channelId, { content: "**Unable to upload file.** Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN." });
            showToast("File Upload Failed", Toasts.Type.FAILURE);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        }
    } catch (error) {
        console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", error);
        sendBotMessage(channelId, { content: "**Unable to upload file.** Check the console for more info. \n-# This is likely an issue with your network connection, firewall, or VPN." });
        showToast("File Upload Failed", Toasts.Type.FAILURE);
        UploadManager.clearAll(channelId, DraftType.SlashCommand);
    }
}

function sendGhostUploadMessage(channelId, filename, progress) {
    const currentUser = UserStore.getCurrentUser();

    const fakeMessage = {
        id: crypto.randomUUID(),
        type: 0,
        channel_id: channelId,
        author: {
            id: currentUser.id,
            username: currentUser.username,
            discriminator: currentUser.discriminator,
            avatar: currentUser.avatar,
            bot: false
        },
        content: "Hello", // leave empty if you only want custom content
        timestamp: new Date(),
        // customRenderedContent: createElement(
        //     "div",
        //     { style: { color: "orange" } },
        //     `Uploading ${filename}... ${progress}%`
        // )
    };

    FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId,
        message: fakeMessage
    });
}


function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target && target.files && target.files.length > 0) {
            const file = target.files[0];
            if (file.size < 10 * 1024 * 1024) {
                // showToast("File is too small");
                // console.log(
                //     Object.keys(UploadStore).filter(key => typeof UploadStore[key] === "function")
                // );
                // UploadStore.addFile(file);
                sendGhostUploadMessage(SelectedChannelStore.getChannelId(), file.name, 0);
                return;
            }

            if (file && file.size >= 10 * 1024 * 1024) {
                const channelId = SelectedChannelStore.getChannelId();
                await uploadFile(file, channelId);
            } else {
                showToast("No file selected");
            }
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
    description: "Bypass Discord's upload limit by uploading files using the 'Upload a Big File' button or /fileupload and they'll get uploaded as links into chat via file uploaders.",
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
                const file = await resolveFile(opts, cmdCtx);
                if (file) {
                    await uploadFile(file, cmdCtx.channel.id);
                } else {
                    sendBotMessage(cmdCtx.channel.id, { content: "No file specified!" });
                    UploadManager.clearAll(cmdCtx.channel.id, DraftType.SlashCommand);
                }
            },
        },
    ],
});
