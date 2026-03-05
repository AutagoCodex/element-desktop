/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

export type PreviewModalStatus = "idle" | "loading" | "ready" | "error" | "unsupported";

export interface PreviewModalMetadata {
    filename: string;
    sizeLabel: string;
    typeBadge: string;
}

export interface PreviewModalState {
    isOpen: boolean;
    status: PreviewModalStatus;
    metadata?: PreviewModalMetadata;
    message?: string;
}

export class PreviewModalStateController {
    private state: PreviewModalState = {
        isOpen: false,
        status: "idle",
    };

    public open(metadata: PreviewModalMetadata): PreviewModalState {
        this.state = {
            isOpen: true,
            status: "loading",
            metadata,
            message: undefined,
        };

        return this.getState();
    }

    public setReady(): PreviewModalState {
        this.state = {
            ...this.state,
            isOpen: true,
            status: "ready",
            message: undefined,
        };

        return this.getState();
    }

    public setError(message: string): PreviewModalState {
        this.state = {
            ...this.state,
            isOpen: true,
            status: "error",
            message,
        };

        return this.getState();
    }

    public setUnsupported(message: string): PreviewModalState {
        this.state = {
            ...this.state,
            isOpen: true,
            status: "unsupported",
            message,
        };

        return this.getState();
    }

    public close(): PreviewModalState {
        this.state = {
            isOpen: false,
            status: "idle",
            metadata: undefined,
            message: undefined,
        };

        return this.getState();
    }

    public getState(): PreviewModalState {
        return {
            ...this.state,
            metadata: this.state.metadata ? { ...this.state.metadata } : undefined,
        };
    }
}
