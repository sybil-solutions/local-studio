import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig } from "../core/config";
import { openDb } from "../core/db";
import { which } from "../core/exec";
import { createKeyStore } from "../core/keys";
import { ensureClientKey } from "./keys";
import { type AgentHarness, ENV_UNSET, SAFE_FLAG, buildLaunch, clientOf, isTerminal } from "./launch-table";
import { createWorkspaceStore } from "./workspaces";

const USAGE = "local-studio agent run <workspaceId> [--print] [--resume] [--home DIR]";
const BIN_DIRS = [join(homedir(), ".local", "bin"), join(homedir(), ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

export const claudeHasHistory = (dir: string) => existsSync(join(homedir(), ".claude", "projects", dir.replace(/[^A-Za-z0-9]/g, "-")));

export const runAgentCli = async (argv: string[]): Promise<number> => {
  const [sub, wsId] = argv;
  if (sub !== "run" || !wsId || !/^ws_[0-9a-f]{8}$/.test(wsId)) {
    console.error(USAGE);
    return 2;
  }
  const print = argv.includes("--print");
  const config = loadConfig(argv);
  const db = openDb(config.dataDir);
  try {
    const store = createWorkspaceStore(db);
    const ws = store.get(wsId);
    const rt = store.runtime(wsId);
    if (!ws || !rt) {
      console.error(`local-studio agent: no workspace ${wsId} in ${config.dataDir}`);
      return 1;
    }
    const harness = ws.harness as AgentHarness;
    if (!isTerminal(harness)) {
      console.error(`local-studio agent: ${ws.harness} is launched by the controller, not by agent run`);
      return 2;
    }
    const client = clientOf(harness);
    const keys = createKeyStore(db, config.dataDir, config.apiKeyOverride);
    const { keyFile } = ensureClientKey(db, keys, config.home, client);
    const gatewayUrl = rt.gatewayUrl ?? `http://127.0.0.1:${config.port}`;
    let resume = argv.includes("--resume");
    if (resume && ws.harness === "claude" && !claudeHasHistory(ws.dir)) resume = false;
    const built = buildLaunch({
      harness,
      home: config.home,
      model: ws.model,
      contextWindow: rt.contextWindow,
      vision: rt.vision,
      dir: ws.dir,
      keyFile,
      gatewayUrl,
      workspaceId: ws.id,
      resume,
      safe: ws.flags.includes(SAFE_FLAG),
      extraArgs: ws.flags,
    });
    if (print) {
      console.log(`workspace ${ws.id} ${ws.name}`);
      console.log(`cwd  ${built.cwd}`);
      console.log(`argv ${JSON.stringify(built.argv)}`);
      console.log(`env  ${Object.keys(built.env).sort().join(" ")}`);
      console.log(`unset ${(ENV_UNSET[harness] ?? []).join(" ")}`);
      console.log(`files ${built.files.map((f) => f.path).join(" ") || "-"}`);
      return 0;
    }
    for (const f of built.files) {
      mkdirSync(dirname(f.path), { recursive: true, mode: 0o700 });
      writeFileSync(f.path, f.content, { mode: f.mode });
      chmodSync(f.path, f.mode);
    }
    mkdirSync(built.cwd, { recursive: true });
    const bin = await which(built.argv[0]!, BIN_DIRS);
    if (!bin) {
      console.error(`local-studio agent: ${built.argv[0]} not found on PATH or in ${BIN_DIRS.join(", ")}`);
      return 127;
    }
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of ENV_UNSET[harness] ?? []) delete env[k];
    delete env.LOCAL_STUDIO_API_KEY;
    Object.assign(env, built.env);
    db.close();
    const child = Bun.spawn([bin, ...built.argv.slice(1)], { cwd: built.cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const fwd = (sig: NodeJS.Signals) => () => child.kill(sig);
    process.on("SIGINT", fwd("SIGINT"));
    process.on("SIGTERM", fwd("SIGTERM"));
    process.on("SIGHUP", fwd("SIGHUP"));
    return await child.exited;
  } finally {
    try {
      db.close();
    } catch {}
  }
};
