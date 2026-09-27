import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentTestResult, GatewayModel, Harness, HarnessInfo } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { redact } from "../core/log";
import { prepareClaudeDesktop, prepareCodexDesktop } from "./desktop";
import { writeDshSettings } from "./dsh";
import type { CliHarness, HarnessManager } from "./harnesses";
import { ensureClientKey } from "./keys";
import { ENV_UNSET, buildLaunch, clientOf, isTerminal } from "./launch-table";
import { defaultDir, newSessionId } from "./sessions";

const TIMEOUT_MS = 120_000;
const PROMPT = "Reply with exactly: ok";

const headless = (h: Harness, bin: string, argv: string[], model: string, dir: string): string[] => {
  switch (h) {
    case "claude":
      return [bin, "-p", PROMPT, "--model", model];
    case "codex":
      return [bin, "exec", "--skip-git-repo-check", "-C", dir, PROMPT];
    case "pi":
    case "omp":
      return [bin, ...argv.slice(1), "-p", "--no-session", PROMPT];
    case "hermes":
      return [bin, "chat", "-q", PROMPT, "-Q"];
    case "droid":
      return [bin, "exec", "-m", "custom:localstudio-0", PROMPT];
    default:
      return [bin];
  }
};

const recorded = async (ctx: Ctx, client: string, since: number): Promise<boolean> => {
  for (let i = 0; i < 10; i++) {
    const r = ctx.db.query<{ n: number }, [string, number]>("SELECT count(*) AS n FROM requests WHERE client = ? AND ts_start >= ?").get(client, since);
    if (r && r.n > 0) return true;
    await Bun.sleep(500);
  }
  return false;
};

const tail = (s: string) => redact(s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().split("\n").filter((l) => l.trim()).slice(-2).join(" ")).slice(0, 240);

export interface TestInput {
  gm: GatewayModel;
  ready: GatewayModel[];
  gatewayUrl: string;
  path: string;
}

export const testHarness = async (ctx: Ctx, harnesses: HarnessManager, info: HarnessInfo, t: TestInput): Promise<AgentTestResult> => {
  const h = info.harness;
  const t0 = Date.now();
  const done = (status: AgentTestResult["status"], reason: string | null): AgentTestResult => ({ harness: h, status, ms: Date.now() - t0, reason });
  if (h === "amp") return done("skipped", "n/a – hosted models only");
  const home = ctx.config.home;
  const dir = defaultDir(home, h);
  const id = newSessionId();
  try {
    mkdirSync(dir, { recursive: true });
    const { keyFile } = ensureClientKey(ctx.db, ctx.keys, home, clientOf(h));
    if (h === "codex-desktop" || h === "claude-desktop") {
      const input = { home, dir, model: t.gm.id, contextWindow: t.gm.contextWindow, keyFile, gatewayUrl: t.gatewayUrl, sessionId: id };
      const prep = h === "codex-desktop" ? prepareCodexDesktop(input) : prepareClaudeDesktop(input);
      const missing = prep.files.filter((f) => !existsSync(f));
      return missing.length ? done("failed", `config not written: ${missing.join(", ")}`) : done("ok", `opens: ${info.path} present, gateway config written, not launched`);
    }
    const found = await harnesses.resolve(h as CliHarness);
    if (!found) return done("failed", "not installed");
    const env: Record<string, string | undefined> = { PATH: t.path, PWD: dir, PYTHONDONTWRITEBYTECODE: "1", LOCAL_STUDIO_API_KEY: undefined };
    let argv: string[];
    if (h === "dsh") {
      const dshHome = join(home, "dsh");
      writeDshSettings(join(dshHome, "settings.yaml"), t.gatewayUrl, t.ready.map((m) => ({ id: m.id, contextWindow: m.contextWindow, vision: m.vision })), t.gm.id);
      Object.assign(env, { DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: "1", LOCAL_STUDIO_API_KEY: (await Bun.file(keyFile).text()).trim() });
      argv = [found.bin, "--profile", "headless", PROMPT];
    } else if (isTerminal(h)) {
      const built = buildLaunch({ harness: h, home, model: t.gm.id, contextWindow: t.gm.contextWindow, vision: t.gm.vision, dir, keyFile, gatewayUrl: t.gatewayUrl, sessionId: id, safe: true });
      for (const f of built.files) {
        if (f.keep && existsSync(f.path)) continue;
        mkdirSync(dirname(f.path), { recursive: true, mode: 0o700 });
        writeFileSync(f.path, f.content, { mode: f.mode });
        chmodSync(f.path, f.mode);
      }
      for (const k of ENV_UNSET[h] ?? []) env[k] = undefined;
      Object.assign(env, built.env);
      argv = headless(h, found.bin, built.argv, t.gm.id, dir);
    } else return done("skipped", `${h} has no headless mode`);
    const r = await ctx.exec(argv, { timeoutMs: TIMEOUT_MS, env, cwd: dir, maxBytes: 1_000_000 });
    if (r.timedOut) return done("failed", `timed out after ${TIMEOUT_MS / 1000} s`);
    if (r.code !== 0) return done("failed", `exit ${r.code}: ${tail(r.stderr || r.stdout) || "no output"}`);
    if (!/\bok\b/i.test(r.stdout)) return done("failed", `no 'ok' in output: ${tail(r.stdout) || "empty"}`);
    if (!(await recorded(ctx, clientOf(h), t0))) return done("failed", `replied ok but no gateway request was recorded for client ${clientOf(h)}`);
    return done("ok", `replied ok via the gateway as ${clientOf(h)}`);
  } catch (e) {
    return done("failed", redact(String(e)).slice(0, 240));
  }
};
