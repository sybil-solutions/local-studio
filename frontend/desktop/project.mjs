#!/usr/bin/env node
// The repo's single automation entry point. Every subcommand's implementation
// lives in ./automation/ as ordinary readable ESM — this file only dispatches.
//
// Four ways in:
//   * `node scripts/project.mjs <command>` (scripts/project.mjs is a symlink
//     here) — the subcommand registry below.
//   * The .githooks/{commit-msg,pre-commit,pre-push} symlinks — dispatched on
//     the invoked basename, with no logic in the hook files themselves.
//   * `setup-hooks`, special-cased so a fresh clone can register the hooks
//     before anything else works.
//   * As a module: electron-builder imports the default export as its
//     afterPack hook (desktop/electron-builder.yml).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterPack } from "./automation/standalone.mjs";
import { frontendDir, repoRoot, run } from "./automation/lib.mjs";

const commands = new Map([
  ["assert-release-main", () => import("./automation/release.mjs").then((m) => m.assertReleaseMain())],
  ["assert-standalone", () => import("./automation/standalone.mjs").then((m) => m.assertStandalone())],
  ["audit-layout", () => import("./automation/validate.mjs").then((m) => m.auditLayout())],
  ["bundle-agent-runtime", () => import("./automation/agent-runtime.mjs").then((m) => m.bundleAgentRuntime())],
  ["check", () => check()],
  ["check-commits", () => import("./automation/commits.mjs").then((m) => m.checkCommits())],
  ["complete-standalone", () => import("./automation/standalone.mjs").then((m) => m.completeStandalone())],
  ["controller-standards", () => import("./automation/validate.mjs").then((m) => m.controllerStandards())],
  ["doctor", () => import("./automation/toolchain.mjs").then((m) => m.doctor())],
  ["link-services", () => import("./automation/toolchain.mjs").then((m) => m.linkServices())],
  ["postbuild-agent-runtime", () => import("./automation/agent-runtime.mjs").then((m) => m.postbuildAgentRuntime())],
  ["prepare-agent-runtime", () => import("./automation/agent-runtime.mjs").then((m) => m.prepareAgentRuntime())],
  ["prepare-next", () => import("./automation/standalone.mjs").then((m) => m.prepareNext())],
  ["setup", () => import("./automation/toolchain.mjs").then((m) => m.setupRepository())],
  ["sign-release", () => import("./automation/release.mjs").then((m) => m.signDesktopRelease())],
  ["stage-release", () => import("./automation/release.mjs").then((m) => m.stageDesktopRelease())],
  ["start", () => import("./automation/start.mjs").then((m) => m.start())],
  ["validate-contracts", () => import("./automation/validate.mjs").then((m) => m.validateContracts())],
  ["validate-package", () => import("./automation/validate.mjs").then((m) => m.validatePackage())],
  ["validate-structure", () => import("./automation/validate.mjs").then((m) => m.validateStructure())],
  ["validate-ui", () => import("./automation/validate.mjs").then((m) => m.validateUi())],
]);

/**
 * The whole quality surface in one command, identical for humans, agents, and
 * anything else: repo gates first (cheap, most likely to catch drift), then
 * each workspace's own gate exactly as CI runs it.
 */
async function check() {
  const validate = await import("./automation/validate.mjs");
  validate.auditLayout();
  validate.validateContracts();
  validate.validateStructure();
  run("bun", ["run", "typecheck"], path.join(repoRoot, "controller"));
  run("bun", ["run", "lint"], path.join(repoRoot, "controller"));
  run("bun", ["run", "check"], path.join(repoRoot, "controller"));
  run("bun", ["run", "check"], path.join(repoRoot, "services", "agent-runtime"));
  run("npm", ["run", "check:quality"], frontendDir);
  console.log("All checks passed");
}

const invoked = path.basename(process.argv[1] ?? "");
if (invoked === "commit-msg") {
  process.argv.splice(2, 0, "--message-file");
  const { checkCommits } = await import("./automation/commits.mjs");
  checkCommits();
} else if (invoked === "pre-commit") {
  const { preCommit } = await import("./automation/hooks.mjs");
  preCommit();
} else if (invoked === "pre-push") {
  const { prePush } = await import("./automation/hooks.mjs");
  prePush();
} else if (
  invoked === "project.mjs" ||
  path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2];
  process.argv.splice(2, 1);
  if (command === "setup-hooks") {
    const { setupHooks } = await import("./automation/toolchain.mjs");
    setupHooks();
  } else if (!command || !commands.has(command)) {
    console.error(`Usage: node scripts/project.mjs <${[...commands.keys()].join("|")}>`);
    process.exit(1);
  } else {
    await commands.get(command)();
  }
}

export default afterPack;
