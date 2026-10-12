import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveBundledPluginDirectory } from "../src/plugin-resources";

// The bundled plugin directory used to be found via a fixed three-rung cwd
// ladder, so it resolved from the repo root and frontend/ and nowhere else.
// Every other working directory the runtime actually runs in — the deployed
// systemd unit (services/agent-runtime) and the standalone Next server
// (frontend/.next/standalone/frontend) — silently got null, which dropped the
// "Local Studio" plugin source and left gmail/google-calendar untrusted and
// without their account block. Pin resolution from cwds far from the repo root.

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const bundled = path.join(repoRoot, "frontend", "desktop", "resources", "plugins");
const originalCwd = process.cwd();
const originalResources = process.env.LOCAL_STUDIO_RESOURCES_PATH;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalResources === undefined) delete process.env.LOCAL_STUDIO_RESOURCES_PATH;
  else process.env.LOCAL_STUDIO_RESOURCES_PATH = originalResources;
});

describe("resolveBundledPluginDirectory", () => {
  test("resolves from a cwd nested well below the repo root", () => {
    delete process.env.LOCAL_STUDIO_RESOURCES_PATH;
    // frontend/.next/standalone/frontend is where `npm run start` puts the
    // Next server; that tree has no desktop/ of its own.
    const standalone = path.join(repoRoot, "frontend", ".next", "standalone", "frontend");
    process.chdir(existsSync(standalone) ? standalone : import.meta.dirname);
    expect(resolveBundledPluginDirectory()).toBe(bundled);
  });

  test("resolves from the deployed agent-runtime working directory", () => {
    delete process.env.LOCAL_STUDIO_RESOURCES_PATH;
    process.chdir(path.resolve(import.meta.dirname, ".."));
    expect(resolveBundledPluginDirectory()).toBe(bundled);
  });

  test("prefers LOCAL_STUDIO_RESOURCES_PATH when it points at real resources", () => {
    const root = mkdtempSync(path.join(tmpdir(), "plugin-resources-"));
    const packaged = path.join(root, "desktop", "resources", "plugins");
    mkdirSync(packaged, { recursive: true });
    process.env.LOCAL_STUDIO_RESOURCES_PATH = root;
    expect(resolveBundledPluginDirectory()).toBe(packaged);
  });

  test("falls back to the cwd walk when the env path has no resources", () => {
    process.env.LOCAL_STUDIO_RESOURCES_PATH = mkdtempSync(path.join(tmpdir(), "plugin-empty-"));
    process.chdir(repoRoot);
    expect(resolveBundledPluginDirectory()).toBe(bundled);
  });
});
