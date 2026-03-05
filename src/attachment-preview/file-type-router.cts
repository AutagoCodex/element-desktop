/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

export type InlinePreviewKind = "image" | "video" | "audio" | "pdf" | "markdown" | "code" | "text" | "unsupported";

export interface InlinePreviewRoute {
    kind: InlinePreviewKind;
    extension?: string;
    language?: string;
    mimeType: string;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    cs: "csharp",
    css: "css",
    go: "go",
    h: "c",
    hpp: "cpp",
    htm: "html",
    html: "html",
    ini: "ini",
    java: "java",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    kt: "kotlin",
    kts: "kotlin",
    less: "css",
    lua: "lua",
    m: "objectivec",
    mm: "objectivec",
    php: "php",
    pl: "perl",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sass: "css",
    scala: "scala",
    scss: "css",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    toml: "toml",
    ts: "typescript",
    tsx: "typescript",
    txt: "plaintext",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
};

const KNOWN_TEXT_MIME_PREFIXES = ["text/"];
const KNOWN_TEXT_MIME_TYPES = new Set([
    "application/json",
    "application/ld+json",
    "application/sql",
    "application/toml",
    "application/x-httpd-php",
    "application/x-sh",
    "application/x-yaml",
    "application/xml",
    "application/yaml",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/xhtml+xml",
]);

function toLower(value?: string): string | undefined {
    return value?.trim().toLowerCase();
}

function sanitizeMimeType(mimeType?: string): string {
    const lowered = toLower(mimeType);
    if (!lowered) return "application/octet-stream";

    const [rawType] = lowered.split(";");
    return rawType?.trim() || "application/octet-stream";
}

function extractFileExtension(fileName?: string, href?: string): string | undefined {
    const loweredName = toLower(fileName);
    const fromName = loweredName?.includes(".") ? loweredName.split(".").pop() : undefined;
    if (fromName && fromName.length > 0) return fromName;

    if (!href) return undefined;
    try {
        const parsed = new URL(href, "https://localhost");
        const path = parsed.pathname.split("/").filter(Boolean).pop();
        const ext = toLower(path)?.split(".").pop();
        if (ext && ext.length > 0) return ext;
    } catch {
        // The URL can be a custom scheme or malformed; ignore.
    }

    return undefined;
}

function isRenderableImageMime(mimeType: string, extension?: string): boolean {
    if (!mimeType.startsWith("image/")) return false;

    // SVG can carry active content; do not inline render from untrusted files.
    if (mimeType === "image/svg+xml" || extension === "svg") return false;

    return true;
}

function isKnownTextMime(mimeType: string): boolean {
    if (KNOWN_TEXT_MIME_TYPES.has(mimeType)) return true;
    return KNOWN_TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function routeAttachmentPreview(input: {
    fileName?: string;
    mimeType?: string;
    href?: string;
}): InlinePreviewRoute {
    const mimeType = sanitizeMimeType(input.mimeType);
    const extension = extractFileExtension(input.fileName, input.href);

    if (isRenderableImageMime(mimeType, extension)) {
        return {
            kind: "image",
            extension,
            mimeType,
        };
    }

    if (mimeType.startsWith("video/")) {
        return {
            kind: "video",
            extension,
            mimeType,
        };
    }

    if (mimeType.startsWith("audio/")) {
        return {
            kind: "audio",
            extension,
            mimeType,
        };
    }

    if (mimeType === "application/pdf" || extension === "pdf") {
        return {
            kind: "pdf",
            extension,
            mimeType,
        };
    }

    if (MARKDOWN_EXTENSIONS.has(extension || "") || mimeType === "text/markdown") {
        return {
            kind: "markdown",
            extension,
            mimeType,
        };
    }

    const inferredLanguage = extension ? CODE_LANGUAGE_BY_EXTENSION[extension] : undefined;

    if (inferredLanguage) {
        return {
            kind: inferredLanguage === "plaintext" ? "text" : "code",
            extension,
            language: inferredLanguage,
            mimeType,
        };
    }

    if (isKnownTextMime(mimeType)) {
        return {
            kind: "text",
            extension,
            mimeType,
        };
    }

    if (extension === "svg") {
        return {
            kind: "unsupported",
            extension,
            mimeType,
        };
    }

    return {
        kind: "unsupported",
        extension,
        mimeType,
    };
}
