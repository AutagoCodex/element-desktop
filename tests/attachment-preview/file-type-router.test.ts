import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { routeAttachmentPreview } = require("../../src/attachment-preview/file-type-router.cts");

test("routes code file by extension when mime is generic", () => {
    const route = routeAttachmentPreview({
        fileName: "main.ts",
        mimeType: "application/octet-stream",
        href: "https://example.invalid/download/main.ts",
    });

    assert.equal(route.kind, "code");
    assert.equal(route.language, "typescript");
});

test("routes markdown by mime and extension", () => {
    const routeByMime = routeAttachmentPreview({
        fileName: "note.bin",
        mimeType: "text/markdown",
        href: "https://example.invalid/download/note.bin",
    });

    const routeByExtension = routeAttachmentPreview({
        fileName: "README.md",
        mimeType: "application/octet-stream",
        href: "https://example.invalid/download/README.md",
    });

    assert.equal(routeByMime.kind, "markdown");
    assert.equal(routeByExtension.kind, "markdown");
});

test("routes PDF via mime and extension", () => {
    const routeByMime = routeAttachmentPreview({
        fileName: "report.bin",
        mimeType: "application/pdf",
    });

    const routeByExt = routeAttachmentPreview({
        fileName: "report.pdf",
        mimeType: "application/octet-stream",
    });

    assert.equal(routeByMime.kind, "pdf");
    assert.equal(routeByExt.kind, "pdf");
});

test("blocks svg as unsupported for inline safety", () => {
    const route = routeAttachmentPreview({
        fileName: "diagram.svg",
        mimeType: "image/svg+xml",
        href: "https://example.invalid/download/diagram.svg",
    });

    assert.equal(route.kind, "unsupported");
});

test("falls back to unsupported for unknown binary type", () => {
    const route = routeAttachmentPreview({
        fileName: "archive.bin",
        mimeType: "application/octet-stream",
        href: "https://example.invalid/download/archive.bin",
    });

    assert.equal(route.kind, "unsupported");
});
