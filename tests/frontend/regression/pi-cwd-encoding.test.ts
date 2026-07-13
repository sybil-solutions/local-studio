import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { encodeCwdForPi } from "@local-studio/agent-runtime/sessions-store";

function piReferenceEncoding(cwd: string): string {
  const resolved = path.resolve(cwd);
  return `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

test("encodeCwdForPi matches pi's session-manager encoding", () => {
  const samples =
    process.platform === "win32"
      ? ["C:\\Users\\dev\\workspace", "D:\\proj", process.cwd()]
      : ["/Users/dev/workspace", "/home/dev/proj", process.cwd()];
  for (const sample of samples) {
    assert.equal(encodeCwdForPi(sample), piReferenceEncoding(sample));
  }
});

test("encodeCwdForPi produces a filesystem-safe directory name", () => {
  const encoded = encodeCwdForPi(process.cwd());
  assert.equal(encoded.includes(":"), false);
  assert.equal(encoded.includes("/"), false);
  assert.equal(encoded.includes("\\"), false);
});
