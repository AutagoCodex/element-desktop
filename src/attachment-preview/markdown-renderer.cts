/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function sanitiseUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    // Require an explicit safe protocol to avoid accidental local/relative navigation.
    if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return null;

    try {
        const parsed = new URL(trimmed);
        if (SAFE_LINK_PROTOCOLS.has(parsed.protocol)) {
            return parsed.toString();
        }
    } catch {
        // Ignore malformed URLs.
    }

    return null;
}

function renderInlineMarkdown(line: string): string {
    let rendered = escapeHtml(line);

    rendered = rendered.replace(/`([^`]+)`/g, (_match, code) => `<code>${escapeHtml(code)}</code>`);
    rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    rendered = rendered.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    rendered = rendered.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text, href) => {
        const safeUrl = sanitiseUrl(href);
        if (!safeUrl) return escapeHtml(text);

        return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}</a>`;
    });

    return rendered;
}

interface CodeBlock {
    language?: string;
    lines: string[];
}

export function renderMarkdownToSafeHtml(markdown: string): string {
    const lines = markdown.replaceAll("\r\n", "\n").split("\n");
    const output: string[] = [];
    let inCodeBlock = false;
    let inList = false;
    let codeBlock: CodeBlock = { lines: [] };

    function closeListIfNeeded(): void {
        if (inList) {
            output.push("</ul>");
            inList = false;
        }
    }

    for (const line of lines) {
        const fenceMatch = line.match(/^```([A-Za-z0-9_\-]*)\s*$/);
        if (fenceMatch) {
            closeListIfNeeded();
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeBlock = {
                    language: fenceMatch[1] || undefined,
                    lines: [],
                };
            } else {
                const languageClass = codeBlock.language ? ` class="language-${escapeHtml(codeBlock.language)}"` : "";
                output.push(`<pre><code${languageClass}>${escapeHtml(codeBlock.lines.join("\n"))}</code></pre>`);
                inCodeBlock = false;
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlock.lines.push(line);
            continue;
        }

        if (!line.trim()) {
            closeListIfNeeded();
            continue;
        }

        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            closeListIfNeeded();
            const level = Math.min(headingMatch[1].length, 6);
            output.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
            continue;
        }

        const listItemMatch = line.match(/^\s*[-*]\s+(.+)$/);
        if (listItemMatch) {
            if (!inList) {
                output.push("<ul>");
                inList = true;
            }
            output.push(`<li>${renderInlineMarkdown(listItemMatch[1])}</li>`);
            continue;
        }

        closeListIfNeeded();
        output.push(`<p>${renderInlineMarkdown(line)}</p>`);
    }

    closeListIfNeeded();

    if (inCodeBlock) {
        const languageClass = codeBlock.language ? ` class="language-${escapeHtml(codeBlock.language)}"` : "";
        output.push(`<pre><code${languageClass}>${escapeHtml(codeBlock.lines.join("\n"))}</code></pre>`);
    }

    return output.join("\n");
}

export function sanitiseMarkdownLinkUrl(url: string): string | null {
    return sanitiseUrl(url);
}
