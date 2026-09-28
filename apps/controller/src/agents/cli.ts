import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../core/config";
import { openDb } from "../core/db";
import { createKeyStore } from "../core/keys";
import { ensureClientKey } from "./keys";
import { ENV_UNSET, buildLaunch, clientOf, isTerminal } from "./launch-table";
import { SESSION_ID, readSpec } from "./sessions";

const USAGE = "local-studio agent run <sessionId> [--print] [--home DIR]";

export const runAgentCli = async (argv: string[]): Promise<number> => {
  const [sub, id] = argv;
  if (sub !== "run" || !id || !SESSION_ID.test(id)) {
    console.error(USAGE);
    return 2;
  }
  const config = loadConfig(argv);
  const spec = readSpec(config.home, id);
  if (!spec) {
    console.error(`local-studio agent: no session ${id} in ${config.home}`);
    return 1;
  }
  if (!isTerminal(spec.harness)) {
    console.error(`local-studio agent: ${spec.harness} is launched by the controller, not by agent run`);
    return 2;
  }
  const db = openDb(config.dataDir);
  let keyFile: string;
  try {
    keyFile = ensureClientKey(db, createKeyStore(db, config.dataDir, config.apiKeyOverride), config.home, clientOf(spec.harness)).keyFile;
  } finally {
    db.close();
  }
  const built = buildLaunch({ ...spec, home: config.home, keyFile, sessionId: spec.id });
  if (argv.includes("--print")) {
    console.log(`session ${spec.id} ${spec.harness}`);
    console.log(`bin  ${spec.bin}`);
    console.log(`cwd  ${built.cwd}`);
    console.log(`argv ${JSON.stringify(built.argv)}`);
    console.log(`env  ${Object.keys(built.env).sort().join(" ")}`);
    console.log(`unset ${(ENV_UNSET[spec.harness] ?? []).join(" ")}`);
    console.log(`files ${built.files.map((f) => f.path).join(" ") || "-"}`);
    return 0;
  }
  for (const f of built.files) {
    if (f.keep && existsSync(f.path)) continue;
    mkdirSync(dirname(f.path), { recursive: true, mode: 0o700 });
    writeFileSync(f.path, f.content, { mode: f.mode });
    chmodSync(f.path, f.mode);
  }
  mkdirSync(built.cwd, { recursive: true });
  if (!existsSync(spec.bin)) {
    console.error(`local-studio agent: ${spec.bin} does not exist any more; install ${spec.harness} again from the agents page`);
    return 127;
  }
  const env: Record<string, string | undefined> = { ...process.env, PATH: spec.path, PWD: built.cwd };
  for (const k of ENV_UNSET[spec.harness] ?? []) delete env[k];
  delete env.LOCAL_STUDIO_API_KEY;
  Object.assign(env, built.env);
  const child = Bun.spawn([spec.bin, ...built.argv.slice(1)], { cwd: built.cwd, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const fwd = (sig: NodeJS.Signals) => () => child.kill(sig);
  process.on("SIGINT", fwd("SIGINT"));
  process.on("SIGTERM", fwd("SIGTERM"));
  process.on("SIGHUP", fwd("SIGHUP"));
  return await child.exited;
};
