import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokens = readFileSync(
  new URL("../src/app/styles/globals/tokens.css", import.meta.url),
  "utf8",
);

test("dark accent themes provide syntax colors", () => {
  const darkTheme = tokens.slice(
    tokens.indexOf("Codex DARK"),
    tokens.indexOf("Legacy local-studio"),
  );
  for (const theme of ["zai-dark", "zai-sky", "zai-violet", "zai-emerald", "zai-rose"]) {
    assert.match(darkTheme, new RegExp(`data-theme=\\"${theme}\\"`));
  }
  assert.match(darkTheme, /--color-syntax-keyword:\s*#7db7df/);
  assert.match(darkTheme, /--color-syntax-string:\s*#75c892/);
});
