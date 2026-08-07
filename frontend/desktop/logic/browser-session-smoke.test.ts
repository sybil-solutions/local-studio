import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repository = path.resolve(import.meta.dirname, "../../..");
const projectScript = readFileSync(path.join(repository, "frontend/desktop/project.mjs"), "utf8");

test("packaged browser smoke carries an isolated session key", () => {
  assert.match(
    projectScript,
    /browser\/navigate[^\n]+"x-local-studio-browser-session": "desktop-package-smoke"/u,
  );
});
