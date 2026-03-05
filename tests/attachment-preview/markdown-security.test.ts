import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
    renderMarkdownToSafeHtml,
    sanitiseMarkdownLinkUrl,
} = require("../../src/attachment-preview/markdown-renderer.cts");

test("escapes raw script tags in markdown", () => {
    const html = renderMarkdownToSafeHtml("# hello\n<script>alert('xss')</script>");

    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;"), true);
});

test("blocks javascript URLs in markdown links", () => {
    const html = renderMarkdownToSafeHtml("[click me](javascript:alert(1))");

    assert.equal(html.includes("javascript:"), false);
    assert.equal(html.includes("<a "), false);
    assert.equal(html.includes("click me"), true);
});

test("allows safe http and mailto links", () => {
    assert.equal(sanitiseMarkdownLinkUrl("https://element.io/docs"), "https://element.io/docs");
    assert.equal(sanitiseMarkdownLinkUrl("mailto:test@example.com"), "mailto:test@example.com");
});
