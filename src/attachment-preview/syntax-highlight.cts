/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

const KEYWORDS: Record<string, string[]> = {
    bash: ["if", "then", "else", "fi", "for", "while", "do", "done", "case", "esac", "function", "export"],
    c: ["if", "else", "switch", "case", "for", "while", "do", "struct", "typedef", "return", "const", "static"],
    cpp: [
        "if",
        "else",
        "switch",
        "case",
        "for",
        "while",
        "class",
        "template",
        "namespace",
        "return",
        "const",
        "static",
        "public",
        "private",
    ],
    css: ["@media", "@supports", "color", "display", "position", "grid", "flex", "font", "background"],
    go: ["func", "package", "import", "type", "struct", "interface", "if", "else", "for", "range", "return", "defer"],
    html: ["doctype", "html", "head", "body", "div", "span", "script", "style"],
    java: ["class", "interface", "public", "private", "protected", "static", "void", "if", "else", "return"],
    javascript: [
        "const",
        "let",
        "var",
        "function",
        "return",
        "class",
        "extends",
        "import",
        "export",
        "if",
        "else",
        "switch",
        "case",
        "new",
        "await",
        "async",
    ],
    json: ["true", "false", "null"],
    kotlin: ["fun", "class", "object", "interface", "val", "var", "if", "else", "when", "return", "null"],
    objectivec: ["@interface", "@implementation", "@property", "if", "else", "return", "nil", "self"],
    perl: ["my", "sub", "if", "elsif", "else", "foreach", "while", "return", "undef"],
    php: ["function", "class", "public", "private", "protected", "if", "else", "return", "null"],
    plaintext: [],
    python: ["def", "class", "if", "elif", "else", "for", "while", "return", "import", "from", "None", "True", "False"],
    ruby: ["def", "class", "module", "if", "elsif", "else", "end", "do", "return", "nil", "true", "false"],
    rust: ["fn", "let", "mut", "struct", "enum", "impl", "trait", "if", "else", "match", "return"],
    scala: ["def", "val", "var", "class", "object", "trait", "if", "else", "match", "case", "return"],
    sql: ["select", "from", "where", "join", "left", "right", "insert", "update", "delete", "group", "order", "limit"],
    swift: ["func", "class", "struct", "enum", "protocol", "if", "else", "guard", "return", "let", "var"],
    toml: [],
    typescript: [
        "const",
        "let",
        "var",
        "type",
        "interface",
        "function",
        "return",
        "class",
        "extends",
        "import",
        "export",
        "if",
        "else",
        "new",
        "as",
        "readonly",
        "enum",
    ],
    xml: [],
    yaml: ["true", "false", "null"],
};

function tokenWrap(pattern: RegExp, className: string, source: string): string {
    return source.replace(pattern, `<span class="${className}">$1</span>`);
}

function maybeHighlightKeywords(language: string, escapedSource: string): string {
    const keywords = KEYWORDS[language] || [];
    if (!keywords.length) return escapedSource;

    const keywordPattern = new RegExp(
        `\\b(${keywords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
        "g",
    );
    return tokenWrap(keywordPattern, "mx_InlineFilePreviewModal_code_keyword", escapedSource);
}

export function renderCodeToHtml(source: string, language?: string): string {
    const escaped = escapeHtml(source);
    const normalisedLanguage = language?.toLowerCase() || "plaintext";

    let highlighted = escaped;
    highlighted = tokenWrap(
        /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
        "mx_InlineFilePreviewModal_code_string",
        highlighted,
    );
    highlighted = tokenWrap(/(\b\d+(?:\.\d+)?\b)/g, "mx_InlineFilePreviewModal_code_number", highlighted);
    highlighted = tokenWrap(/((?:\/\/|#).*$)/gm, "mx_InlineFilePreviewModal_code_comment", highlighted);
    highlighted = maybeHighlightKeywords(normalisedLanguage, highlighted);

    return highlighted;
}
