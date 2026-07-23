import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDiffPreview } from "./diff-preview-model";

describe("diff preview model", () => {
  test("turns synthetic edits into readable rows and accurate totals", () => {
    const preview = parseDiffPreview(
      "@@ edit 2 @@\n-Old heading\n-\n+New heading\n+\n+New paragraph",
    );

    assert.equal(preview.additions, 3);
    assert.equal(preview.deletions, 2);
    assert.deepEqual(preview.lines[0], { content: "Edit 2", kind: "hunk", marker: "" });
    assert.deepEqual(preview.lines[1], {
      content: "Old heading",
      kind: "deletion",
      marker: "−",
    });
    assert.deepEqual(preview.lines[3], {
      content: "New heading",
      kind: "addition",
      marker: "+",
    });
  });

  test("does not count unified diff metadata as changed lines", () => {
    const preview = parseDiffPreview(
      "diff --git a/report.md b/report.md\n--- a/report.md\n+++ b/report.md\n@@ -1 +1 @@\n-old\n+new",
    );

    assert.equal(preview.additions, 1);
    assert.equal(preview.deletions, 1);
    assert.deepEqual(
      preview.lines.slice(0, 3).map((line) => line.kind),
      ["meta", "meta", "meta"],
    );
  });
});
