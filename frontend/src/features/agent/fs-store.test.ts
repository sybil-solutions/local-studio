import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { realpathSync } from "node:fs";
import os from "node:os";
import { assertWorkspaceRoot } from "./fs-store";

describe("assertWorkspaceRoot", () => {
  test("accepts an ordinary directory under the user's home", () => {
    const home = realpathSync(os.homedir());
    assert.equal(assertWorkspaceRoot(home), home);
  });

  test("rejects the filesystem root", () => {
    assert.throws(() => assertWorkspaceRoot("/"), /not an allowed workspace root/);
  });

  // macOS resolves /etc and /var into /private, which used to slip past the
  // literal system-root list and let the fs routes serve /etc/passwd. The
  // /private/* spellings only exist on darwin, so only assert them there.
  test("rejects system directories through their symlinked real paths", () => {
    if (process.platform === "win32") return;
    const roots = ["/etc", "/var", "/usr", "/bin"];
    if (process.platform === "darwin") roots.push("/private/etc", "/private/var");
    for (const root of roots) {
      assert.throws(
        () => assertWorkspaceRoot(root),
        /not an allowed workspace root/,
        `expected ${root} to be rejected`,
      );
    }
  });
});
