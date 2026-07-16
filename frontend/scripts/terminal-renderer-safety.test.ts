import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("terminal rendering does not load the unstable WebGL glyph atlas", async () => {
  const frontend = new URL("../", import.meta.url);
  const [source, packageJson] = await Promise.all([
    readFile(new URL("src/features/agent/ui/terminal-panel.tsx", frontend), "utf8"),
    readFile(new URL("package.json", frontend), "utf8"),
  ]);

  assert.doesNotMatch(source, /addon-webgl|WebglAddon/);
  assert.doesNotMatch(packageJson, /@xterm\/addon-webgl/);
});
