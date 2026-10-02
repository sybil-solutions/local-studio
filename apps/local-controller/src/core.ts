import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import * as Data from "effect/Data";
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

export const writeJson = (path: string, value: unknown): void => {
  writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
  renameSync(`${path}.${process.pid}.tmp`, path);
};

export const decodeJson = <S extends Schema.Top>(schema: S, text: string): S["Type"] | undefined => {
  const r = Schema.decodeUnknownOption(Schema.fromJsonString(schema as never))(text);
  return r._tag === "Some" ? (r.value as S["Type"]) : undefined;
};

export const readJson = <S extends Schema.Top>(path: string, schema: S, fallback: S["Type"]): S["Type"] =>
  (existsSync(path) ? decodeJson(schema, readFileSync(path, "utf8")) : undefined) ?? fallback;

export const loadConfig = (): Config => {
  const name = hostname().split(".")[0] || "local";
  const defaults = {
    id: `${name}-${randomBytes(3).toString("hex")}`,
    name,
    url: `http://127.0.0.1:${port}`,
    fleetKey: randomBytes(24).toString("base64url"),
    peers: [],
    excludePorts: [],
    engineKeys: {},
    registry: { url: "https://github.com/0xSero/local-ai-registry.git", dir: join(home, "registry"), ref: "origin/main" },
    modelsDir: join(homedir(), "models"),
  };
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (!existsSync(configPath)) writeJson(configPath, defaults);
  chmodSync(configPath, 0o600);
  return Schema.decodeUnknownSync(Config)({ ...defaults, ...(JSON.parse(readFileSync(configPath, "utf8")) as object) });
};

export const saveConfig = (c: Config): void => writeJson(configPath, c);

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const exec = (argv: string[], timeoutMs: number, opts: { signal?: AbortSignal; env?: Record<string, string>; stdin?: string } = {}): Effect.Effect<ExecResult> =>
  Effect.promise(async () => {
    let proc: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">;
    try {
      proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin), env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env } }) as never;
    } catch (e) {
      return { code: 127, stdout: "", stderr: String(e) };
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    const onAbort = () => proc.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort);
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    return { code: timedOut ? 124 : code, stdout, stderr };
  });

export const lastLine = (r: ExecResult): string => r.stderr.trim().split("\n").pop() || String(r.code);

export class HttpError extends Data.Error<{ readonly status: number; readonly code: string; readonly message: string }> {}

export const httpError = (status: number, code: string, message: string) => new HttpError({ status, code, message });
export const fail = (status: number, code: string, message: string) => Effect.fail(httpError(status, code, message));

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export const errorResponse = (e: unknown): Response =>
  e instanceof HttpError ? json({ error: { code: e.code, message: e.message } }, e.status) : json({ error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) } }, 500);

export const fetchJson = (url: string, timeoutMs: number, headers: Record<string, string> = {}): Effect.Effect<{ status: number; body: unknown; headers: Headers }, string> =>
  Effect.tryPromise({
    try: async () => {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
      return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
    },
    catch: (e) => (e instanceof Error ? e.message : String(e)),
  });

export const now = (): string => new Date().toISOString();
