import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveAllowedWorkspace } from "../src/projects-store";

const originalRoots = process.env.WORKSPACE_ROOTS;
const temporaryRoots: string[] = [];

afterEach(() => {
  if (originalRoots === undefined) delete process.env.WORKSPACE_ROOTS;
  else process.env.WORKSPACE_ROOTS = originalRoots;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-workspace-"));
  temporaryRoots.push(root);
  const allowed = path.join(root, "allowed");
  const sibling = path.join(root, "allowed-prefix-trap");
  mkdirSync(allowed);
  mkdirSync(sibling);
  process.env.WORKSPACE_ROOTS = allowed;
  return { root, allowed, sibling };
}

describe("workspace containment", () => {
  test("accepts a real descendant and rejects a path-prefix sibling", () => {
    const { allowed, sibling } = fixture();
    const child = path.join(allowed, "project");
    mkdirSync(child);
    expect(resolveAllowedWorkspace(child)).toBe(realpathSync.native(child));
    expect(() => resolveAllowedWorkspace(sibling)).toThrow(/outside WORKSPACE_ROOTS/);
  });

  test("rejects a symlink that escapes an allowed root", () => {
    const { allowed, sibling } = fixture();
    const link = path.join(allowed, "escape");
    symlinkSync(sibling, link, "dir");
    expect(() => resolveAllowedWorkspace(link)).toThrow(/outside WORKSPACE_ROOTS/);
  });
});
