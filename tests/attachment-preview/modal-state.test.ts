import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PreviewModalStateController } = require("../../src/attachment-preview/preview-modal-state.cts");

test("modal open and close transitions", () => {
    const controller = new PreviewModalStateController();

    const openState = controller.open({
        filename: "readme.md",
        sizeLabel: "1.2 KB",
        typeBadge: "MARKDOWN",
    });

    assert.equal(openState.isOpen, true);
    assert.equal(openState.status, "loading");
    assert.equal(openState.metadata?.filename, "readme.md");

    controller.setReady();
    const ready = controller.getState();
    assert.equal(ready.status, "ready");

    const closed = controller.close();
    assert.equal(closed.isOpen, false);
    assert.equal(closed.status, "idle");
    assert.equal(closed.metadata, undefined);
});

test("modal enters unsupported fallback state", () => {
    const controller = new PreviewModalStateController();

    controller.open({
        filename: "binary.exe",
        sizeLabel: "12 KB",
        typeBadge: "UNSUPPORTED",
    });

    const state = controller.setUnsupported("Preview is not available for this file type.");

    assert.equal(state.isOpen, true);
    assert.equal(state.status, "unsupported");
    assert.equal(state.message, "Preview is not available for this file type.");
});
