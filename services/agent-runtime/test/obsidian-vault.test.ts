import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasObsidianVaultSync, listObsidianVaultsSync } from "../src/obsidian-vault";
import { buildAgentSessionOptionsSync } from "../src/pi-runtime-helpers";

// Vault discovery is the whole load gate for the obsidian extension, and its
// only input is a file Obsidian writes for its own purposes. The cases that
// matter are the ones a hand-written parser gets wrong: a vault the user
// deleted but Obsidian still lists, several vaults with no obvious default, and
// a machine where Obsidian was never installed — which must read as "none",
// never as an error.

const original = process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG;

afterEach(() => {
  if (original === undefined) delete process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG;
  else process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = original;
});

function fixture(vaults: Record<string, { path: string; ts?: number; open?: boolean }>): string {
  const root = mkdtempSync(path.join(tmpdir(), "obsidian-config-"));
  const file = path.join(root, "obsidian.json");
  writeFileSync(file, JSON.stringify({ vaults }));
  process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = file;
  return file;
}

function vaultDir(name: string): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "obsidian-vault-")), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("listObsidianVaultsSync", () => {
  test("puts the open vault first, then the most recently opened", () => {
    const stale = vaultDir("Old");
    const recent = vaultDir("Recent");
    const open = vaultDir("Open");
    fixture({
      a: { path: stale, ts: 1_000 },
      b: { path: recent, ts: 9_000 },
      c: { path: open, ts: 5_000, open: true },
    });
    expect(listObsidianVaultsSync().map((vault) => vault.name)).toEqual(["Open", "Recent", "Old"]);
  });

  test("drops a vault whose directory is gone", () => {
    const present = vaultDir("Present");
    fixture({
      a: { path: present, ts: 2 },
      b: { path: path.join(tmpdir(), "obsidian-vault-that-never-existed"), ts: 3 },
    });
    expect(listObsidianVaultsSync().map((vault) => vault.path)).toEqual([present]);
  });

  test("reports no vaults when Obsidian has never run here", () => {
    process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = path.join(tmpdir(), "no-such-obsidian.json");
    expect(listObsidianVaultsSync()).toEqual([]);
    expect(hasObsidianVaultSync()).toBe(false);
  });

  test("survives a config file Obsidian is midway through writing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "obsidian-config-"));
    const file = path.join(root, "obsidian.json");
    writeFileSync(file, '{"vaults":{"a":{"path":"/tmp/x"');
    process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = file;
    expect(listObsidianVaultsSync()).toEqual([]);
  });
});

describe("session options", () => {
  // The extension trusts the runtime's list over its own config read, so the
  // tools can only answer about the vaults the gate saw.
  test("exports the resolved vaults to the extension", () => {
    const dir = vaultDir("Notes");
    fixture({ a: { path: dir, ts: 7, open: true } });
    const options = buildAgentSessionOptionsSync({ options: {}, processEnv: {} as NodeJS.ProcessEnv });
    expect(JSON.parse(options.envInjections.LOCAL_STUDIO_OBSIDIAN_VAULTS ?? "[]")).toEqual([
      { path: dir, name: "Notes", open: true, lastOpened: new Date(7).toISOString() },
    ]);
  });

  test("exports nothing when there is no vault", () => {
    process.env.LOCAL_STUDIO_OBSIDIAN_CONFIG = path.join(tmpdir(), "no-such-obsidian.json");
    const options = buildAgentSessionOptionsSync({ options: {}, processEnv: {} as NodeJS.ProcessEnv });
    expect(options.envInjections.LOCAL_STUDIO_OBSIDIAN_VAULTS).toBeUndefined();
    expect(options.extensionPaths.some((entry) => entry.endsWith("obsidian.ts"))).toBe(false);
  });
});
