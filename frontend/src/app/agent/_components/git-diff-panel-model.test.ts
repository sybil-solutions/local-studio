import { describe, expect, it } from "vitest";
import {
  diffLineClassName,
  diffLinePrefix,
  gitDiffHeaderTitle,
  parseUnifiedDiff,
} from "./git-diff-panel-model";

describe("git diff panel model", () => {
  it("parses unified diff files with additions, deletions, and line numbers", () => {
    const files = parseUnifiedDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -2,2 +2,3 @@
 keep
-old
+new
+extra`);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: "a.ts", additions: 2, deletions: 1 });
    expect(files[0]?.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ["meta", undefined, undefined],
      ["meta", undefined, undefined],
      ["meta", undefined, undefined],
      ["context", 2, 2],
      ["del", 3, undefined],
      ["add", undefined, 3],
      ["add", undefined, 4],
    ]);
  });

  it("resolves header, row classes, and visible prefixes", () => {
    expect(gitDiffHeaderTitle({ branch: "main" }, "/repo")).toBe("main");
    expect(gitDiffHeaderTitle(null, "/repo")).toBe("Working tree diff");
    expect(gitDiffHeaderTitle(null, null)).toBe("No directory");
    expect(diffLineClassName("add")).toContain("emerald");
    expect(diffLinePrefix("del")).toBe("-");
    expect(diffLinePrefix("meta")).toBe("");
  });
});
