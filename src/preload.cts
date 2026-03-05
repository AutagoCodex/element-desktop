/*
Copyright 2024 New Vector Ltd.
Copyright 2018, 2019 , 2021 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// This file is compiled to CommonJS rather than ESM otherwise the browser chokes on the import statement.

import { ipcRenderer, contextBridge, IpcRendererEvent } from "electron";

import { setupInlineFilePreview } from "./attachment-preview/inline-file-preview.cjs";

// Expose only expected IPC wrapper APIs to the renderer process to avoid
// handing out generalised messaging access.

const CHANNELS = [
    "app_onAction",
    "before-quit",
    "check_updates",
    "install_update",
    "ipcCall",
    "ipcReply",
    "loudNotification",
    "preferences",
    "seshat",
    "seshatReply",
    "setBadgeCount",
    "update-downloaded",
    "userDownloadCompleted",
    "userDownloadAction",
    "openDesktopCapturerSourcePicker",
    "userAccessToken",
    "homeserverUrl",
    "serverSupportedVersions",
    "showToast",
];

contextBridge.exposeInMainWorld("electron", {
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void {
        if (!CHANNELS.includes(channel)) {
            console.error(`Unknown IPC channel ${channel} ignored`);
            return;
        }
        ipcRenderer.on(channel, listener);
    },
    send(channel: string, ...args: any[]): void {
        if (!CHANNELS.includes(channel)) {
            console.error(`Unknown IPC channel ${channel} ignored`);
            return;
        }
        ipcRenderer.send(channel, ...args);
    },

    async initialise(): Promise<{
        protocol: string;
        sessionId: string;
        config: IConfigOptions;
        supportedSettings: Record<string, boolean>;
        /**
         * Do we need to render badge overlays for new notifications?
         */
        supportsBadgeOverlay: boolean;
    }> {
        ipcRenderer.emit("initialise");
        const [{ protocol, sessionId }, config, supportedSettings] = await Promise.all([
            ipcRenderer.invoke("getProtocol"),
            ipcRenderer.invoke("getConfig"),
            ipcRenderer.invoke("getSupportedSettings"),
        ]);
        return { protocol, sessionId, config, supportedSettings, supportsBadgeOverlay: process.platform === "win32" };
    },

    async setSettingValue(settingName: string, value: any): Promise<void> {
        return ipcRenderer.invoke("setSettingValue", settingName, value);
    },
    async getSettingValue(settingName: string): Promise<any> {
        return ipcRenderer.invoke("getSettingValue", settingName);
    },
});

const pendingOpenRequests: string[] = [];

ipcRenderer.on("userDownloadCompleted", (_event, payload) => {
    const name = String(payload?.name || "");
    const index = pendingOpenRequests.findIndex((pendingName) => !pendingName || pendingName === name);
    if (index === -1) return;

    pendingOpenRequests.splice(index, 1);
    ipcRenderer.send("userDownloadAction", { id: payload?.id, open: true });
});

setupInlineFilePreview({
    requestDownload: ({ url, fileName, openAfterDownload }) => {
        if (openAfterDownload) {
            pendingOpenRequests.push(fileName);
        }

        const rendererDocument = (globalThis as any).document;
        if (!rendererDocument?.body) return;

        const anchor = rendererDocument.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.rel = "noopener noreferrer";
        anchor.setAttribute("data-inline-preview-bypass", "1");
        anchor.style.display = "none";

        rendererDocument.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    },
});
