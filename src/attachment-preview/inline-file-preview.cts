/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { routeAttachmentPreview, type InlinePreviewRoute } from "./file-type-router.cjs";
import { renderMarkdownToSafeHtml } from "./markdown-renderer.cjs";
import { PreviewModalStateController, type PreviewModalMetadata } from "./preview-modal-state.cjs";
import { renderCodeToHtml } from "./syntax-highlight.cjs";

const PREVIEW_STYLE_ID = "mx-inline-file-preview-styles";
const INLINE_PREVIEW_FLAG = "__mxInlineFilePreviewSetupDone";

const TEXT_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
const MARKDOWN_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const PDF_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;

interface DownloadRequest {
    url: string;
    fileName: string;
    openAfterDownload: boolean;
}

interface SetupInlineFilePreviewOptions {
    requestDownload: (request: DownloadRequest) => void;
}

interface AttachmentMetadata {
    href: string;
    fileName: string;
    mimeType?: string;
    sizeInBytes?: number;
}

interface ReadBytesResult {
    bytes: Uint8Array;
    contentType: string;
}

function asDocument(): any | null {
    const maybeDocument = (globalThis as any).document;
    if (!maybeDocument) return null;
    return maybeDocument;
}

function asWindow(): any | null {
    const maybeWindow = globalThis as any;
    if (!maybeWindow?.addEventListener) return null;
    return maybeWindow;
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function formatSize(sizeInBytes?: number): string {
    if (sizeInBytes === undefined || Number.isNaN(sizeInBytes)) return "Unknown size";
    if (sizeInBytes < 1024) return `${sizeInBytes} B`;

    const units = ["KB", "MB", "GB", "TB"];
    let size = sizeInBytes / 1024;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseDataSize(anchor: any): number | undefined {
    const candidates = [anchor?.getAttribute?.("data-size"), anchor?.dataset?.size, anchor?.dataset?.fileSize];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const parsed = Number.parseInt(candidate, 10);
        if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
    }

    return undefined;
}

function isLikelyAttachmentAnchor(anchor: any): boolean {
    const href = String(anchor?.getAttribute?.("href") || anchor?.href || "").trim();
    if (!href) return false;

    if (anchor?.getAttribute?.("data-inline-preview-bypass") === "1") return false;

    if (href.startsWith("blob:")) return true;

    const classes = String(anchor?.className || "");
    const hintClasses = ["mx_MFileBody", "mx_MImageBody", "mx_MVideoBody", "mx_MAudioBody", "mx_FilePanel"];
    if (hintClasses.some((className) => classes.includes(className))) return true;

    const parent = anchor?.closest?.(".mx_MFileBody, .mx_MImageBody, .mx_MVideoBody, .mx_MAudioBody");
    if (parent) return true;

    if (anchor?.hasAttribute?.("download")) return true;

    try {
        const parsed = new URL(href, "https://localhost");
        const mediaPathHints = ["/_matrix/media/", "/_matrix/client/v1/media/", "/download/", "/thumbnail/"];
        return mediaPathHints.some((pathHint) => parsed.pathname.includes(pathHint));
    } catch {
        return false;
    }
}

function deriveFilename(anchor: any): string {
    const explicit = anchor?.getAttribute?.("data-filename") || anchor?.dataset?.filename || anchor?.download;
    if (explicit) return explicit;

    const ariaLabel = anchor?.getAttribute?.("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const text = (anchor?.textContent || "").trim();
    if (text && text.length <= 200 && !text.startsWith("http")) return text;

    const href = String(anchor?.getAttribute?.("href") || anchor?.href || "").trim();
    if (href) {
        try {
            const parsed = new URL(href, "https://localhost");
            const segments = parsed.pathname.split("/").filter(Boolean);
            const fromPath = segments[segments.length - 1];
            if (fromPath) return decodeURIComponent(fromPath);
            const fromParam = parsed.searchParams.get("filename");
            if (fromParam) return fromParam;
        } catch {
            // Ignore parse errors.
        }
    }

    return "attachment";
}

function deriveMimeType(anchor: any): string | undefined {
    const candidates = [
        anchor?.type,
        anchor?.getAttribute?.("type"),
        anchor?.dataset?.mimeType,
        anchor?.getAttribute?.("data-mime-type"),
        anchor?.getAttribute?.("data-mimetype"),
    ];

    for (const candidate of candidates) {
        if (candidate && String(candidate).trim()) return String(candidate).trim();
    }

    return undefined;
}

function determineBadge(route: InlinePreviewRoute): string {
    switch (route.kind) {
        case "image":
            return "IMAGE";
        case "video":
            return "VIDEO";
        case "audio":
            return "AUDIO";
        case "pdf":
            return "PDF";
        case "markdown":
            return "MARKDOWN";
        case "code":
            return route.language ? route.language.toUpperCase() : "CODE";
        case "text":
            return "TEXT";
        case "unsupported":
        default:
            return "UNSUPPORTED";
    }
}

function shouldSkipClick(event: any): boolean {
    if (event?.defaultPrevented) return true;
    if (event?.button !== 0) return true;
    if (event?.metaKey || event?.altKey || event?.ctrlKey || event?.shiftKey) return true;
    return false;
}

function detectBinaryBytes(bytes: Uint8Array): boolean {
    if (bytes.length === 0) return false;

    const sampleLength = Math.min(bytes.length, 4096);
    let suspicious = 0;

    for (let i = 0; i < sampleLength; i += 1) {
        const code = bytes[i];
        if (code === 0) return true;

        const isTabOrLineBreak = code === 9 || code === 10 || code === 13;
        const isPrintableAscii = code >= 32 && code <= 126;
        if (!isTabOrLineBreak && !isPrintableAscii) suspicious += 1;
    }

    return suspicious / sampleLength > 0.3;
}

async function readBytesWithLimit(response: any, maxBytes: number): Promise<Uint8Array> {
    const reader = response.body?.getReader?.();
    if (!reader) {
        const fallback = new Uint8Array(await response.arrayBuffer());
        if (fallback.byteLength > maxBytes) {
            throw new Error(`Preview blocked: file exceeds ${formatSize(maxBytes)} limit`);
        }
        return fallback;
    }

    let total = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;

        const value = chunk.value as Uint8Array;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`Preview blocked: file exceeds ${formatSize(maxBytes)} limit`);
        }

        chunks.push(value);
    }

    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return output;
}

async function fetchBytesWithLimits(url: string, maxBytes: number): Promise<ReadBytesResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            credentials: "include",
            signal: controller.signal,
        } as any);

        if (!response.ok) {
            throw new Error(`Preview unavailable (${response.status})`);
        }

        const advertisedLength = Number.parseInt(response.headers.get("content-length") || "", 10);
        if (!Number.isNaN(advertisedLength) && advertisedLength > maxBytes) {
            throw new Error(`Preview blocked: file exceeds ${formatSize(maxBytes)} limit`);
        }

        const bytes = await readBytesWithLimit(response, maxBytes);

        return {
            bytes,
            contentType: response.headers.get("content-type") || "application/octet-stream",
        };
    } catch (error) {
        if ((error as Error).name === "AbortError") {
            throw new Error("Preview timed out");
        }

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function injectStyles(document: any): void {
    if (document.getElementById(PREVIEW_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = PREVIEW_STYLE_ID;
    style.textContent = `
        .mx_InlineFilePreviewModal_overlay {
            position: fixed;
            inset: 0;
            z-index: 20000;
            background: rgba(12, 16, 22, 0.74);
            backdrop-filter: blur(2px);
            display: none;
            align-items: center;
            justify-content: center;
            padding: 24px;
        }

        .mx_InlineFilePreviewModal {
            width: min(1100px, 95vw);
            height: min(90vh, 860px);
            background: #11161f;
            border: 1px solid #2d3544;
            border-radius: 14px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: #f6f8ff;
            box-shadow: 0 16px 42px rgba(0, 0, 0, 0.5);
        }

        .mx_InlineFilePreviewModal_header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 14px 16px;
            border-bottom: 1px solid #2a3140;
            background: #161d29;
        }

        .mx_InlineFilePreviewModal_headerMeta {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .mx_InlineFilePreviewModal_filename {
            font-size: 15px;
            line-height: 20px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .mx_InlineFilePreviewModal_subtitle {
            font-size: 12px;
            color: #aeb8cc;
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .mx_InlineFilePreviewModal_badge {
            display: inline-flex;
            align-items: center;
            border: 1px solid #4366d8;
            color: #b8c9ff;
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 11px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .mx_InlineFilePreviewModal_close {
            border: 0;
            background: transparent;
            color: #d8dff0;
            font-size: 24px;
            line-height: 1;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 8px;
        }

        .mx_InlineFilePreviewModal_close:hover {
            background: #273044;
        }

        .mx_InlineFilePreviewModal_body {
            flex: 1;
            min-height: 0;
            overflow: auto;
            padding: 16px;
            background: #0f141d;
        }

        .mx_InlineFilePreviewModal_actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            border-top: 1px solid #2a3140;
            padding: 12px 16px;
            background: #161d29;
        }

        .mx_InlineFilePreviewModal_button {
            border: 1px solid #3e4f76;
            background: #223257;
            color: #f0f4ff;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            padding: 8px 12px;
        }

        .mx_InlineFilePreviewModal_button:hover {
            background: #2c4172;
        }

        .mx_InlineFilePreviewModal_button--secondary {
            background: #1d2433;
            border-color: #3a4459;
            color: #d7deef;
        }

        .mx_InlineFilePreviewModal_button--secondary:hover {
            background: #253044;
        }

        .mx_InlineFilePreviewModal_state {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 200px;
            color: #c3cbe0;
            font-size: 14px;
            text-align: center;
            padding: 20px;
        }

        .mx_InlineFilePreviewModal_error {
            color: #ffb7b7;
        }

        .mx_InlineFilePreviewModal_pre {
            margin: 0;
            white-space: pre;
            overflow: auto;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 13px;
            line-height: 1.45;
            color: #eaf0ff;
            background: #0b111b;
            border: 1px solid #233048;
            border-radius: 10px;
            padding: 16px;
        }

        .mx_InlineFilePreviewModal_markdown {
            color: #dce3f5;
            font-size: 14px;
            line-height: 1.55;
            max-width: 900px;
            margin: 0 auto;
        }

        .mx_InlineFilePreviewModal_markdown pre {
            overflow: auto;
            background: #0b111b;
            border: 1px solid #233048;
            border-radius: 10px;
            padding: 14px;
        }

        .mx_InlineFilePreviewModal_markdown code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        }

        .mx_InlineFilePreviewModal_markdown a {
            color: #9fb8ff;
            text-decoration: underline;
            text-underline-offset: 2px;
        }

        .mx_InlineFilePreviewModal_media,
        .mx_InlineFilePreviewModal_pdf {
            width: 100%;
            height: calc(100% - 6px);
            border: 0;
            border-radius: 10px;
            background: #000;
        }

        .mx_InlineFilePreviewModal_image {
            display: block;
            max-width: 100%;
            max-height: 100%;
            margin: 0 auto;
            border-radius: 10px;
            object-fit: contain;
            background: #000;
        }

        .mx_InlineFilePreviewModal_code_keyword {
            color: #90adff;
            font-weight: 600;
        }

        .mx_InlineFilePreviewModal_code_string {
            color: #94d9b4;
        }

        .mx_InlineFilePreviewModal_code_number {
            color: #f5c26a;
        }

        .mx_InlineFilePreviewModal_code_comment {
            color: #7f90ab;
            font-style: italic;
        }
    `;

    document.head.appendChild(style);
}

class InlineFilePreviewModal {
    private readonly stateController = new PreviewModalStateController();
    private readonly overlay: any;
    private readonly body: any;
    private readonly filename: any;
    private readonly subtitle: any;
    private readonly badge: any;
    private readonly openExternalButton: any;
    private readonly downloadButton: any;

    private currentAttachment: AttachmentMetadata | null = null;
    private requestToken = 0;
    private objectUrls = new Set<string>();

    public constructor(
        private readonly document: any,
        private readonly options: SetupInlineFilePreviewOptions,
    ) {
        injectStyles(document);

        this.overlay = document.createElement("div");
        this.overlay.className = "mx_InlineFilePreviewModal_overlay";
        this.overlay.innerHTML = `
            <section class="mx_InlineFilePreviewModal" role="dialog" aria-modal="true" aria-label="Attachment preview">
                <header class="mx_InlineFilePreviewModal_header">
                    <div class="mx_InlineFilePreviewModal_headerMeta">
                        <div class="mx_InlineFilePreviewModal_filename" data-field="filename"></div>
                        <div class="mx_InlineFilePreviewModal_subtitle">
                            <span data-field="size">Unknown size</span>
                            <span class="mx_InlineFilePreviewModal_badge" data-field="badge">UNSUPPORTED</span>
                        </div>
                    </div>
                    <button type="button" class="mx_InlineFilePreviewModal_close" data-action="close" aria-label="Close preview">×</button>
                </header>
                <div class="mx_InlineFilePreviewModal_body" data-field="body"></div>
                <footer class="mx_InlineFilePreviewModal_actions">
                    <button type="button" class="mx_InlineFilePreviewModal_button mx_InlineFilePreviewModal_button--secondary" data-action="open-external">Open in external app</button>
                    <button type="button" class="mx_InlineFilePreviewModal_button" data-action="download">Download</button>
                </footer>
            </section>
        `;

        this.filename = this.overlay.querySelector('[data-field="filename"]');
        this.subtitle = this.overlay.querySelector('[data-field="size"]');
        this.badge = this.overlay.querySelector('[data-field="badge"]');
        this.body = this.overlay.querySelector('[data-field="body"]');
        this.openExternalButton = this.overlay.querySelector('[data-action="open-external"]');
        this.downloadButton = this.overlay.querySelector('[data-action="download"]');

        this.overlay.addEventListener("click", (event: any) => {
            if (event.target === this.overlay) {
                this.close();
                return;
            }

            const action = event.target?.getAttribute?.("data-action");
            if (action === "close") this.close();
            if (action === "download") this.download(false);
            if (action === "open-external") this.download(true);
        });

        document.body.appendChild(this.overlay);
    }

    public isOpen(): boolean {
        return this.stateController.getState().isOpen;
    }

    public close(): void {
        this.requestToken += 1;
        this.currentAttachment = null;

        for (const objectUrl of this.objectUrls) {
            URL.revokeObjectURL(objectUrl);
        }
        this.objectUrls.clear();

        this.body.replaceChildren();
        this.overlay.style.display = "none";
        this.stateController.close();
    }

    public async openFromAnchor(anchor: any): Promise<void> {
        const href = String(anchor?.getAttribute?.("href") || anchor?.href || "").trim();
        if (!href) return;

        const attachment: AttachmentMetadata = {
            href,
            fileName: deriveFilename(anchor),
            mimeType: deriveMimeType(anchor),
            sizeInBytes: parseDataSize(anchor),
        };

        this.currentAttachment = attachment;

        const route = routeAttachmentPreview({
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            href: attachment.href,
        });

        const metadata: PreviewModalMetadata = {
            filename: attachment.fileName,
            sizeLabel: formatSize(attachment.sizeInBytes),
            typeBadge: determineBadge(route),
        };

        this.stateController.open(metadata);
        this.renderMetadata(metadata);
        this.setOpenExternalEnabled(true);
        this.downloadButton.disabled = false;
        this.renderLoading("Preparing preview…");

        this.overlay.style.display = "flex";

        const token = ++this.requestToken;

        try {
            await this.renderRoute(route, attachment, token);
        } catch (error) {
            if (token !== this.requestToken) return;

            const message = error instanceof Error ? error.message : "Preview failed";
            this.stateController.setError(message);
            this.renderMessage(message, true);
        }
    }

    private renderMetadata(metadata: PreviewModalMetadata): void {
        this.filename.textContent = metadata.filename;
        this.subtitle.textContent = metadata.sizeLabel;
        this.badge.textContent = metadata.typeBadge;
    }

    private setOpenExternalEnabled(enabled: boolean): void {
        this.openExternalButton.disabled = !enabled;
        this.openExternalButton.setAttribute("aria-disabled", String(!enabled));
        this.openExternalButton.style.opacity = enabled ? "1" : "0.55";
        this.openExternalButton.style.cursor = enabled ? "pointer" : "not-allowed";
    }

    private renderLoading(message: string): void {
        this.body.innerHTML = `<div class="mx_InlineFilePreviewModal_state">${escapeHtml(message)}</div>`;
    }

    private renderMessage(message: string, isError = false): void {
        const className = isError
            ? "mx_InlineFilePreviewModal_state mx_InlineFilePreviewModal_error"
            : "mx_InlineFilePreviewModal_state";
        this.body.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
    }

    private async renderRoute(route: InlinePreviewRoute, attachment: AttachmentMetadata, token: number): Promise<void> {
        if (!attachment.href.startsWith("blob:") && attachment.href.startsWith("mxc:")) {
            this.stateController.setError("Encrypted or unavailable attachment cannot be previewed yet.");
            this.setOpenExternalEnabled(false);
            this.renderMessage("Encrypted or unavailable attachment cannot be previewed yet.", true);
            return;
        }

        switch (route.kind) {
            case "image": {
                const image = this.document.createElement("img");
                image.className = "mx_InlineFilePreviewModal_image";
                image.src = attachment.href;
                image.alt = attachment.fileName;
                image.loading = "lazy";
                image.referrerPolicy = "no-referrer";
                image.addEventListener("error", () => {
                    if (token !== this.requestToken) return;
                    this.stateController.setError("Image preview unavailable");
                    this.renderMessage("Image preview unavailable", true);
                });
                this.body.replaceChildren(image);
                this.stateController.setReady();
                return;
            }
            case "video": {
                const video = this.document.createElement("video");
                video.className = "mx_InlineFilePreviewModal_media";
                video.src = attachment.href;
                video.controls = true;
                video.preload = "metadata";
                video.setAttribute("playsinline", "");
                video.addEventListener("error", () => {
                    if (token !== this.requestToken) return;
                    this.stateController.setError("Video preview unavailable");
                    this.renderMessage("Video preview unavailable", true);
                });
                this.body.replaceChildren(video);
                this.stateController.setReady();
                return;
            }
            case "audio": {
                const audio = this.document.createElement("audio");
                audio.className = "mx_InlineFilePreviewModal_media";
                audio.src = attachment.href;
                audio.controls = true;
                audio.preload = "metadata";
                audio.addEventListener("error", () => {
                    if (token !== this.requestToken) return;
                    this.stateController.setError("Audio preview unavailable");
                    this.renderMessage("Audio preview unavailable", true);
                });
                this.body.replaceChildren(audio);
                this.stateController.setReady();
                return;
            }
            case "markdown": {
                const { bytes } = await fetchBytesWithLimits(attachment.href, MARKDOWN_PREVIEW_MAX_BYTES);
                if (token !== this.requestToken) return;

                if (detectBinaryBytes(bytes)) {
                    this.stateController.setUnsupported("Markdown preview disabled for binary content.");
                    this.setOpenExternalEnabled(false);
                    this.renderMessage("Markdown preview disabled for binary content.");
                    return;
                }

                const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
                const markdown = this.document.createElement("div");
                markdown.className = "mx_InlineFilePreviewModal_markdown";
                markdown.innerHTML = renderMarkdownToSafeHtml(text);
                this.body.replaceChildren(markdown);
                this.subtitle.textContent = formatSize(bytes.byteLength);
                this.stateController.setReady();
                return;
            }
            case "code":
            case "text": {
                const { bytes } = await fetchBytesWithLimits(attachment.href, TEXT_PREVIEW_MAX_BYTES);
                if (token !== this.requestToken) return;

                if (detectBinaryBytes(bytes)) {
                    this.stateController.setUnsupported("Preview unavailable for binary files.");
                    this.setOpenExternalEnabled(false);
                    this.renderMessage("Preview unavailable for binary files.");
                    return;
                }

                const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
                const pre = this.document.createElement("pre");
                pre.className = "mx_InlineFilePreviewModal_pre";

                if (route.kind === "code") {
                    pre.innerHTML = renderCodeToHtml(text, route.language);
                } else {
                    pre.textContent = text;
                }

                this.body.replaceChildren(pre);
                this.subtitle.textContent = formatSize(bytes.byteLength);
                this.stateController.setReady();
                return;
            }
            case "pdf": {
                const { bytes } = await fetchBytesWithLimits(attachment.href, PDF_PREVIEW_MAX_BYTES);
                if (token !== this.requestToken) return;

                const blob = new Blob([bytes], { type: "application/pdf" });
                const blobUrl = URL.createObjectURL(blob);
                this.objectUrls.add(blobUrl);

                const iframe = this.document.createElement("iframe");
                iframe.className = "mx_InlineFilePreviewModal_pdf";
                iframe.src = blobUrl;
                iframe.setAttribute("sandbox", "allow-same-origin allow-downloads");
                iframe.referrerPolicy = "no-referrer";
                this.body.replaceChildren(iframe);
                this.subtitle.textContent = formatSize(bytes.byteLength);
                this.stateController.setReady();
                return;
            }
            case "unsupported":
            default:
                this.stateController.setUnsupported("Preview is not available for this file type.");
                this.setOpenExternalEnabled(false);
                this.renderMessage("Preview is not available for this file type.");
                return;
        }
    }

    private download(openAfterDownload: boolean): void {
        if (!this.currentAttachment) return;
        if (openAfterDownload && this.openExternalButton.disabled) return;

        this.options.requestDownload({
            url: this.currentAttachment.href,
            fileName: this.currentAttachment.fileName,
            openAfterDownload,
        });
    }
}

export function setupInlineFilePreview(options: SetupInlineFilePreviewOptions): void {
    const document = asDocument();
    const windowObject = asWindow();
    if (!document || !windowObject) return;

    if ((windowObject as any)[INLINE_PREVIEW_FLAG]) return;
    (windowObject as any)[INLINE_PREVIEW_FLAG] = true;

    const install = (): void => {
        if (!document.body || !document.head) {
            return;
        }

        const modal = new InlineFilePreviewModal(document, options);

        document.addEventListener(
            "click",
            (event: any) => {
                if (shouldSkipClick(event)) return;
                if (event.target?.closest?.(".mx_InlineFilePreviewModal_overlay")) return;

                const anchor = event.target?.closest?.("a");
                if (!anchor) return;
                if (!isLikelyAttachmentAnchor(anchor)) return;

                event.preventDefault();
                event.stopPropagation();
                void modal.openFromAnchor(anchor);
            },
            true,
        );

        windowObject.addEventListener("keydown", (event: any) => {
            if (event.key === "Escape" && modal.isOpen()) {
                event.preventDefault();
                modal.close();
            }
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
        install();
    }
}
