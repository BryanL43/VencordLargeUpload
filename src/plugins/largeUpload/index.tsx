/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, Argument, CommandContext, sendBotMessage } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { OpenExternalIcon } from "@components/Icons";
import { Devs } from "@utils/constants";
import { insertTextIntoChatInputBox, sendMessage } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { DraftType, Forms, Menu, PermissionsBits, PermissionStore, React, SelectedChannelStore, showToast, Switch, Toasts, UploadManager } from "@webpack/common";

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
            { label: "Yes", value: "Yes" },
            { label: "No", value: "No", default: true },
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

function sendTextToChat(text: string) {
    if (settings.store.autoSend === "No") {
        insertTextIntoChatInputBox(text);
    } else {
        const channelId = SelectedChannelStore.getChannelId();
        sendMessage(channelId, { content: text });
    }
}

async function resolveFile(options: Argument[], ctx: CommandContext): Promise<File | null> {
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
        const arrayBuffer = await file.arrayBuffer();
        const fileType = file.type;

        // Prompt the server for a presigned URL
        const serverResponse = await Native.promptPresignedURL("https://api.largeupload.cloud/generate-upload");
        const presignedUrl = serverResponse.uploadUrl;
        const embedUrl = serverResponse.pageUrl;

        // Upload the file
        const uploadResult = await Native.uploadFileToCloud(presignedUrl, arrayBuffer, fileType);
        if (uploadResult === 200) {
            setTimeout(() => sendTextToChat(`${embedUrl} `), 10);
            UploadManager.clearAll(channelId, DraftType.SlashCommand);
        } else {
            console.error("Unable to upload file. This is likely an issue with your network connection, firewall, or VPN.", uploadResult);
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

function triggerFileUpload() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.style.display = "none";

    fileInput.onchange = async event => {
        const target = event.target as HTMLInputElement;
        if (target && target.files && target.files.length > 0) {
            const file = target.files[0];
            if (file) {
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
