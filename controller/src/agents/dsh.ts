import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { Ctx } from "../context";
import { redact } from "../core/log";
import { readKey } from "./launch-table";

export const DSH_PROVIDER = "localstudio-gateway";
const LOGIN_RE = /^dsh web: (http:\/\/\S+)/;

export interface DshModel {
  id: string;
  contextWindow: number | null;
  vision: boolean | null;
}

export interface DshStatus {
  running: boolean;
  port: number;
  url: string | null;
  home: string;
  cwd: string | null;
  startedAt: number | null;
}

export interface DshManager {
  status(): DshStatus;
  takeLoginUrl(): string | null;
  ensure(opts: { bin: string; path: string; models: DshModel[]; defaultModel: string; cwd: string; keyFile: string; gatewayUrl: string }): Promise<{ ok: boolean; detail: string }>;
  refresh(): Promise<void>;
  stop(): void;
}

export const writeDshSettings = (path: string, gatewayUrl: string, models: DshModel[], defaultModel: string): { firstWrite: boolean } => {
  const exists = existsSync(path);
  const text = exists ? readFileSync(path, "utf8") : "";
  const doc = text.trim() ? YAML.parseDocument(text) : new YAML.Document({});
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML; refusing to rewrite it`);
  const provider = {
    displayName: "Local Studio",
    api: "openai-completions",
    baseURL: `${gatewayUrl.replace(/\/+$/, "")}/v1`,
    apiKeyEnv: "LOCAL_STUDIO_API_KEY",
    defaultInput: ["text", "image"],
    models: models.map((m) => ({
      id: m.id,
      name: m.id,
      ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      input: m.vision === false ? ["text"] : ["text", "image"],
    })),
  };
  doc.setIn(["llm-pi-ai", "providers", DSH_PROVIDER], doc.createNode(provider));
  const firstWrite = !exists || !doc.has("agent-default-model");
  if (firstWrite) doc.set("agent-default-model", doc.createNode({ provider: DSH_PROVIDER, model: defaultModel }));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, doc.toString(), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return { firstWrite };
};

export const createDsh = (ctx: Ctx): DshManager => {
  const home = join(ctx.config.home, "dsh");
  const port = Number(process.env.LOCAL_STUDIO_DSH_PORT ?? 3090);
  const logFile = join(home, "web.log");
  let child: ReturnType<typeof Bun.spawn> | null = null;
  let loginUrl: string | null = null;
  let running = false;
  let startedAt: number | null = null;
  let stopping = false;
  let restarts: number[] = [];
  let lastLaunch: Parameters<DshManager["ensure"]>[0] | null = null;

  const log = (line: string) => {
    try {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      appendFileSync(logFile, `${redact(line)}\n`, { mode: 0o600 });
    } catch {}
  };

  const probe = async (): Promise<boolean> => {
    try {
      const r = await ctx.fetch(`http://127.0.0.1:${port}/`, { method: "GET", timeoutMs: 2000 });
      await r.body?.cancel();
      return r.status === 200 || r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400);
    } catch {
      return false;
    }
  };

  const pipe = async (s: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of s) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        const m = LOGIN_RE.exec(line);
        if (m) {
          loginUrl = m[1]!;
          log("dsh web: login URL issued (kept in memory, not logged)");
        } else if (line.trim()) log(line);
      }
    }
  };

  const spawn = (opts: Parameters<DshManager["ensure"]>[0]) => {
    const key = readKey(opts.keyFile);
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.LOCAL_STUDIO_API_KEY;
    Object.assign(env, {
      DSH_HOME: home,
      LOCAL_STUDIO_API_KEY: key,
      DSH_TELEMETRY_DISABLED: "1",
      PATH: opts.path,
    });
    mkdirSync(opts.cwd, { recursive: true });
    const p = Bun.spawn([opts.bin, "web", "--port", String(port), "--no-open"], { cwd: opts.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    child = p;
    startedAt = Date.now();
    void pipe(p.stdout as ReadableStream<Uint8Array>);
    void pipe(p.stderr as ReadableStream<Uint8Array>);
    ctx.log.info(`dsh: started dsh web on 127.0.0.1:${port} (pid ${p.pid}, DSH_HOME=${home})`);
    void p.exited.then((code) => {
      if (child === p) child = null;
      running = false;
      if (stopping) return;
      ctx.log.warn(`dsh: dsh web exited with ${code}`);
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < 600_000);
      if (restarts.length < 5 && lastLaunch) {
        restarts.push(now);
        setTimeout(() => {
          if (!stopping && !child && lastLaunch) spawn(lastLaunch);
        }, 5000);
      }
    });
  };

  const status = (): DshStatus => ({ running, port, url: running ? `http://127.0.0.1:${port}/` : null, home, cwd: lastLaunch?.cwd ?? null, startedAt });

  return {
    status,
    takeLoginUrl() {
      const u = loginUrl;
      loginUrl = null;
      return u;
    },
    async refresh() {
      running = await probe();
    },
    async ensure(opts) {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const { firstWrite } = writeDshSettings(join(home, "settings.yaml"), opts.gatewayUrl, opts.models, opts.defaultModel);
      if (firstWrite) ctx.log.info(`dsh: wrote ${join(home, "settings.yaml")} with default model ${opts.defaultModel}`);
      lastLaunch = opts;
      if (child || (await probe())) {
        running = true;
        return { ok: true, detail: child ? "dsh web already running (settings reload live)" : `something already answers on :${port}` };
      }
      stopping = false;
      spawn(opts);
      for (let i = 0; i < 120; i++) {
        await Bun.sleep(500);
        if (!child) return { ok: false, detail: `dsh web exited during startup; see ${logFile}` };
        if (await probe()) {
          running = true;
          return { ok: true, detail: `dsh web ready on :${port}` };
        }
      }
      return { ok: false, detail: `dsh web did not answer on :${port} within 60 s; see ${logFile}` };
    },
    stop() {
      stopping = true;
      if (child) {
        child.kill("SIGTERM");
        const p = child;
        setTimeout(() => {
          if (p.exitCode === null) p.kill("SIGKILL");
        }, 5000).unref();
      }
      child = null;
      running = false;
      startedAt = null;
    },
  };
};
