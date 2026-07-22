import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightLines } from "@/features/agent/highlight-cache";
import { languageForPath } from "./filesystem-file-viewer";

test("file viewer resolves syntax languages from paths", () => {
  assert.equal(languageForPath("src/example.tsx"), "typescript");
  assert.equal(languageForPath("Dockerfile.dev"), "dockerfile");
  assert.equal(languageForPath("styles/theme.less"), "css");
  assert.equal(languageForPath("LICENSE"), null);
});

test("file viewer highlighting preserves lines and emits syntax tokens", () => {
  const rendered = highlightLines("typescript", ["const answer = 42;", "export { answer };"]);
  assert.equal(rendered.length, 2);
  assert.match(rendered[0] ?? "", /hljs-keyword/);
  assert.match(rendered[1] ?? "", /hljs-keyword/);
});
