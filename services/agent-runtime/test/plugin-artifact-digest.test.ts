import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { discoverPluginBundles, PluginDiscoveryError } from "../src/plugin-discovery";
import { pluginArtifactDigest } from "../src/plugin-artifact-digest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(name = "bundle"): string {
  const parent = mkdtempSync(path.join(tmpdir(), "local-studio-plugin-artifact-"));
  roots.push(parent);
  const root = path.join(parent, name);
  mkdirSync(root);
  return root;
}

const digest = (root: string, limits = {}): Promise<string> =>
  Effect.runPromise(pluginArtifactDigest(root, limits));

function manifest(root: string): void {
  mkdirSync(path.join(root, ".codex-plugin"));
  writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "digest-fixture", version: "1.0.0" }),
  );
}

describe("plugin artifact identity", () => {
  test("is stable across creation order and mtimes", async () => {
    const left = fixture("left");
    const right = fixture("right");
    mkdirSync(path.join(left, "nested"));
    writeFileSync(path.join(left, "z.txt"), "z");
    writeFileSync(path.join(left, "nested", "a.txt"), "a");
    mkdirSync(path.join(right, "nested"));
    writeFileSync(path.join(right, "nested", "a.txt"), "a");
    writeFileSync(path.join(right, "z.txt"), "z");
    utimesSync(path.join(right, "z.txt"), new Date(1_000), new Date(2_000));
    expect(await digest(left)).toBe(await digest(right));
  });

  test("changes with content, mode, path, and symlink target", async () => {
    if (process.platform === "win32") return;
    const root = fixture();
    mkdirSync(path.join(root, "targets"));
    writeFileSync(path.join(root, "targets", "one"), "same");
    writeFileSync(path.join(root, "targets", "two"), "same");
    writeFileSync(path.join(root, "entry"), "value");
    symlinkSync("targets/one", path.join(root, "link"));
    const initial = await digest(root);
    writeFileSync(path.join(root, "entry"), "changed");
    const contentChanged = await digest(root);
    expect(contentChanged).not.toBe(initial);
    chmodSync(path.join(root, "entry"), 0o700);
    const modeChanged = await digest(root);
    expect(modeChanged).not.toBe(contentChanged);
    chmodSync(path.join(root, "entry"), 0o4700);
    const specialModeChanged = await digest(root);
    if ((statSync(path.join(root, "entry")).mode & 0o7000) !== 0) {
      expect(specialModeChanged).not.toBe(modeChanged);
    }
    rmSync(path.join(root, "link"));
    symlinkSync("targets/two", path.join(root, "link"));
    const symlinkChanged = await digest(root);
    expect(symlinkChanged).not.toBe(specialModeChanged);
    writeFileSync(path.join(root, "renamed"), "changed");
    rmSync(path.join(root, "entry"));
    expect(await digest(root)).not.toBe(symlinkChanged);
  });

  test("rejects escaping, dangling, and cyclic symlinks", async () => {
    if (process.platform === "win32") return;
    const parent = fixture("container");
    const root = path.join(parent, "plugin");
    mkdirSync(root);
    writeFileSync(path.join(parent, "outside"), "outside-secret");
    symlinkSync("../outside", path.join(root, "escape"));
    await expect(digest(root)).rejects.toThrow(/unsafe|cannot be read/);
    rmSync(path.join(root, "escape"));
    symlinkSync("missing", path.join(root, "dangling"));
    await expect(digest(root)).rejects.toThrow(/cannot be read/);
    rmSync(path.join(root, "dangling"));
    symlinkSync("cycle", path.join(root, "cycle"));
    await expect(digest(root)).rejects.toThrow(/cannot be read/);
  });

  test("rejects special files and bounded inputs without exposing contents", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "large"), "private-value");
    await expect(digest(root, { maxFileBytes: 2 })).rejects.toThrow(/large/);
    try {
      await digest(root, { maxEntries: 1 });
      throw new Error("expected bounded traversal to fail");
    } catch (error) {
      expect(String(error)).not.toContain("private-value");
    }
    if (process.platform === "win32") return;
    rmSync(path.join(root, "large"));
    const socket = path.join(root, "socket");
    const server = createServer();
    const listening = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPERM") resolve(false);
        else reject(error);
      });
      server.listen(socket, () => resolve(true));
    });
    if (!listening) return;
    try {
      await expect(digest(root)).rejects.toThrow(/unsupported/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("discovery assigns the digest and fails closed on an unsafe bundle", async () => {
    const root = fixture();
    manifest(root);
    const source = [{ label: "Fixture", dir: root, priority: 1 }];
    const bundles = await Effect.runPromise(discoverPluginBundles(source, 0));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    if (process.platform === "win32") return;
    symlinkSync("missing", path.join(root, "unsafe"));
    await expect(Effect.runPromise(discoverPluginBundles(source, 0))).rejects.toThrow(
      /unsafe|cannot be read/,
    );
  });

  test("discovery reports every concurrently unreadable plugin source", async () => {
    if (process.platform === "win32") return;
    const parent = fixture("invalid-plugins");
    const left = path.join(parent, "left");
    const right = path.join(parent, "right");
    mkdirSync(left);
    mkdirSync(right);
    manifest(left);
    manifest(right);
    symlinkSync("missing", path.join(left, "unsafe"));
    symlinkSync("missing", path.join(right, "unsafe"));
    try {
      await Effect.runPromise(
        discoverPluginBundles([{ label: "Fixture", dir: parent, priority: 1 }], 1),
      );
      throw new Error("expected discovery to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PluginDiscoveryError);
      expect((error as PluginDiscoveryError).sourceDigests).toHaveLength(2);
    }
  });
});
