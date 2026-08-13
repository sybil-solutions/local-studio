import { cpSync, existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";

// The dev-channel app mirrors the stable app's state so you are testing the dev
// build against your real projects and sessions — but the copy is STRICTLY ONE
// WAY. Nothing here ever writes into the stable directory; the dev app then
// works only inside its own user-data dir, so a broken dev build cannot corrupt
// the app you actually rely on.
//
// The list is an allowlist, not a denylist: a new file in the stable app is
// invisible to dev until someone adds it here on purpose. Chromium caches are
// omitted (they are large and rebuild themselves).
const MIRRORED_ENTRIES = [
  "pi-agent",
  "agent-session-metadata.json",
  "automations",
  "goals",
  "mcp",
  "chats.db",
  "controller.db",
  "controllers.json",
  "connectors.json",
  "projects.json",
  "session-prefs.json",
  "ui-preferences.json",
  "desktop-settings.json",
  "api-settings.json",
  "Local Storage",
] as const;

// Deliberately NOT mirrored, and it should stay that way:
//   oauth/, oauth-vault.json, google-account.json — duplicating credentials into
//     a second app is not something to do silently; sign in to dev separately.
//   litter-bridge.json, litter-controller-id, litter-mutation-idempotency.sqlite
//     — device identity. Two apps claiming one controller id would make the
//     mobile bridge ambiguous about which install it is talking to.
//   logs/, runtime/, computer-use/, *.pid, *.port — per-install runtime state.

export type DevMirrorResult = { copied: string[]; skipped: string[] };

export function mirrorStableUserData(options: {
  stableDir: string;
  devDir: string;
}): DevMirrorResult {
  const { stableDir, devDir } = options;
  const copied: string[] = [];
  const skipped: string[] = [];

  if (path.resolve(stableDir) === path.resolve(devDir)) {
    throw new Error("dev-channel mirror refused: source and destination are the same directory");
  }
  if (!existsSync(stableDir)) return { copied, skipped: [...MIRRORED_ENTRIES] };

  for (const entry of MIRRORED_ENTRIES) {
    const source = path.join(stableDir, entry);
    if (!existsSync(source)) {
      skipped.push(entry);
      continue;
    }
    const target = path.join(devDir, entry);
    try {
      // Replace rather than merge: a half-old, half-new session directory is
      // worse than a clean snapshot of whatever stable currently holds.
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, {
        recursive: statSync(source).isDirectory(),
        force: true,
        errorOnExist: false,
      });
      copied.push(entry);
    } catch (error) {
      // A mirror failure must never stop the dev app from starting.
      console.warn(`[desktop] dev mirror skipped ${entry}:`, error);
      skipped.push(entry);
    }
  }
  return { copied, skipped };
}
