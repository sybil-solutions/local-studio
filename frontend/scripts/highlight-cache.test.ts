import assert from "node:assert/strict";
import test from "node:test";
import { highlightFenced, highlightLines } from "../src/features/agent/highlight-cache";
import {
  detectLang,
  toolFilePath,
  toolResultText,
} from "../src/features/agent/ui/timeline/tool-metadata";

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

test("infers source language for read tool previews", () => {
  const block = {
    kind: "tool" as const,
    id: "read-1",
    name: "read_file",
    status: "done" as const,
    text: "",
    args: { path: "/tmp/panel.css" },
  };
  const path = toolFilePath(block);
  assert.equal(path, "/tmp/panel.css");
  assert.equal(detectLang(path), "css");
  assert.match(highlightFenced(detectLang(path), "#panel { color: red; }"), /hljs-selector-id/);
  assert.equal(toolResultText({ ...block, text: "import math", argsText: "{}" }), "import math");
});
