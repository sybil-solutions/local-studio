import { stat } from "node:fs/promises";
import { hasEnabledConnectorsSync } from "./connectors-service";
import { hasGithubCliSync } from "./github-cli";
import { hasObsidianVaultSync } from "./obsidian-vault";
import { resolveBundledResource } from "./plugin-resources";
import type { PluginRow } from "./plugin-contract";

/**
 * The bundled extensions, listed so the Plugins tab tells the whole truth.
 *
 * `runtimeExtensionPaths()` loads these from the desktop resources directory on
 * every session build, which means the agent runs nine extensions the user
 * never wrote. A plugin page that lists only `<agentDir>/extensions` hides all
 * of them — exactly the "page that hides half of what actually runs" the
 * contract warns against. So this module describes the same inventory,
 * read-only, with each row's gate evaluated the same way the loader evaluates
 * it (same helper for the sync gates; a note for the per-session ones, whose
 * state genuinely differs between sessions and has no single answer here).
 *
 * Kept as its own module rather than folded into user-plugins.ts so the
 * writable store stays what it says it is: the contents of one directory.
 */

type BuiltinExtension = {
  id: string;
  file: string;
  /** True/false from the same sync gate the loader uses; null = per-session. */
  loads: () => boolean | null;
  note: string;
};

const BUILTIN_EXTENSIONS: BuiltinExtension[] = [
  {
    id: "local-studio-timeouts",
    file: "local-studio-timeouts.ts",
    loads: () => true,
    note: "Always loaded — enforces the session time limits.",
  },
  {
    id: "local-studio-agent-policy",
    file: "local-studio-agent-policy.ts",
    loads: () => true,
    note: "Always loaded — applies Local Studio's agent policy.",
  },
  {
    id: "subagents",
    file: "subagents.ts",
    loads: () => true,
    note: "Always loaded — lets the agent spawn subagent sessions.",
  },
  {
    id: "automations",
    file: "automations.ts",
    loads: () => true,
    note: "Always loaded — lets the agent manage scheduled automations.",
  },
  {
    id: "cua",
    file: "cua.ts",
    loads: () => null,
    note: "Loads per session, when the Browser tool is on.",
  },
  {
    id: "chrome",
    file: "chrome.ts",
    loads: () => null,
    note: "Loads per session, when the browser backend is your own Chrome.",
  },
  {
    id: "github",
    file: "github.ts",
    loads: hasGithubCliSync,
    note: "Loads when the gh CLI is installed.",
  },
  {
    id: "obsidian",
    file: "obsidian.ts",
    loads: hasObsidianVaultSync,
    note: "Loads when Obsidian has registered a vault.",
  },
  {
    id: "connectors",
    file: "connectors.ts",
    loads: hasEnabledConnectorsSync,
    note: "Loads when at least one connector is enabled.",
  },
];

export async function listBuiltinPlugins(): Promise<PluginRow[]> {
  const rows: PluginRow[] = [];
  for (const extension of BUILTIN_EXTENSIONS) {
    const target = resolveBundledResource("pi-extensions", extension.file);
    if (!target) continue;
    const info = await stat(target).catch(() => null);
    if (!info) continue;
    rows.push({
      id: extension.id,
      file: extension.file,
      path: target,
      // A per-session gate has no single answer outside a session; the row
      // shows "built in" either way and the note carries the condition.
      enabled: extension.loads() !== false,
      bytes: info.size,
      updated_at: info.mtime.toISOString(),
      read_only: true,
      builtin: true,
      note: extension.note,
    });
  }
  return rows;
}
