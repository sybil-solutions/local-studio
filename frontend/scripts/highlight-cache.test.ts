import assert from "node:assert/strict";
import test from "node:test";
import { highlightFenced, highlightLines } from "../src/features/agent/highlight-cache";

test("highlights code languages used by the filesystem and tool previews", () => {
  const css = highlightFenced("css", "#panel { position: absolute; border: 1px solid #fff; }");
  assert.match(css, /hljs-selector-id/);
  assert.match(css, /hljs-attribute/);
  assert.match(css, /hljs-number/);
  assert.match(highlightFenced("java", "class Studio {}"), /hljs-keyword/);
  assert.match(highlightFenced("toml", "port = 8080"), /hljs-attr/);
});

test("preserves embedded language context across filesystem lines", () => {
  const rendered = highlightLines("html", ["<style>", ".card { color: red; }", "</style>"]);
  assert.equal(rendered.length, 3);
  assert.match(rendered[1] ?? "", /language-css/);
  assert.match(rendered[1] ?? "", /hljs-selector-class/);
  for (const line of rendered) {
    assert.equal(line.match(/<span/g)?.length ?? 0, line.match(/<\/span>/g)?.length ?? 0);
  }
});
