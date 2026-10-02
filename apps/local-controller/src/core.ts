import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const VERSION = "0.1.0";

export const Config = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  fleetKey: Schema.String,
  peers: Schema.Array(Schema.String),
  excludePorts: Schema.Array(Schema.Number),
  engineKeys: Schema.Record(Schema.String, Schema.String),
  registry: Schema.Struct({ url: Schema.String, dir: Schema.String, ref: Schema.String }),
  modelsDir: Schema.String,
});
export type Config = typeof Config.Type;

export const home = process.env.LOCAL_STUDIO_T3_HOME ?? join(homedir(), ".local-studio-t3");
export const port = Number(process.env.LOCAL_STUDIO_T3_PORT ?? 18091);
const configPath = join(home, "config.json");

export const writeJson = (path: string, value: unknown, mode = 0o600): void => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, { mode });
  renameSync(tmp, path);
};

export const readJson = <S extends Schema.Top>(path: string, schema: S, fallback: S["Type"]): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema as never)(JSON.parse(readFileSync(path, "utf8"))) as S["Type"];
  } catch {
    return fallback;
  }
};

const defaults = (): Config => ({
  id: `${hostname().split(".")[0]}-${randomBytes(3).toString("hex")}`,
  name: hostname().split(".")[0] ?? "local",
  url: `http://127.0.0.1:${port}`,
  fleetKey: randomBytes(24).toString("base64url"),
  peers: [],
  excludePorts: [],
  engineKeys: {},
  registry: { url: "https://github.com/0xSero/local-ai-registry.git", dir: join(home, "registry"), ref: "origin/main" },
  modelsDir: join(homedir(), "models"),
});

export const loadConfig = (): Config => {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!existsSync(configPath)) writeJson(configPath, defaults());
  chmodSync(configPath, 0o600);
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  return Schema.decodeUnknownSync(Config)({ ...defaults(), ...raw });
};

export const saveConfig = (c: Config): void => writeJson(configPath, c);

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_BYTES = 16 * 1024 * 1024;

export const exec = (argv: string[], timeoutMs: number, opts: { cwd?: string; signal?: AbortSignal; env?: Record<string, string> } = {}): Effect.Effect<ExecResult> =>
  Effect.promise(async () => {
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(argv, { ...(opts.cwd ? { cwd: opts.cwd } : {}), stdout: "pipe", stderr: "pipe", stdin: "ignore", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env } });
    } catch (e) {
      return { code: 127, stdout: "", stderr: String(e), timedOut: false };
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => proc.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort);
    const read = async (s: ReadableStream<Uint8Array> | number | undefined) => {
      if (!(s instanceof ReadableStream)) return "";
      const text = await new Response(s).text();
      return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
    };
    const [stdout, stderr, code] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    return { code: timedOut ? 124 : code, stdout, stderr, timedOut };
  });

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const errorResponse = (e: unknown): Response =>
  e instanceof HttpError
    ? json({ error: { code: e.code, message: e.message } }, e.status)
    : json({ error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) } }, 500);

export const fetchJson = (url: string, timeoutMs: number, headers: Record<string, string> = {}): Effect.Effect<{ status: number; body: unknown; headers: Headers }, string> =>
  Effect.tryPromise({
    try: async () => {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
      const text = await r.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {}
      return { status: r.status, body, headers: r.headers };
    },
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });

export const now = (): string => new Date().toISOString();
