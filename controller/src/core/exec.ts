export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

export interface ExecOptions {
  timeoutMs: number;
  input?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  maxBytes?: number;
}

export const exec = async (cmd: string[], opts: ExecOptions): Promise<ExecResult> => {
  const t0 = performance.now();
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, {
      stdin: opts.input === undefined ? "ignore" : new Blob([opts.input]),
      stdout: "pipe",
      stderr: "pipe",
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      cwd: opts.cwd,
    });
  } catch (e) {
    return { code: null, stdout: "", stderr: String(e), timedOut: false, ms: 0 };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, opts.timeoutMs);
  const max = opts.maxBytes ?? 16 * 1024 * 1024;
  const read = async (s: ReadableStream<Uint8Array> | number | undefined | null): Promise<string> => {
    if (!s || typeof s === "number") return "";
    const text = await new Response(s).text();
    return text.length > max ? text.slice(0, max) : text;
  };
  const [stdout, stderr] = await Promise.all([read(proc.stdout as ReadableStream<Uint8Array>), read(proc.stderr as ReadableStream<Uint8Array>)]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code: timedOut ? null : code, stdout, stderr, timedOut, ms: performance.now() - t0 };
};

export const which = async (bin: string, extraDirs: string[] = []): Promise<string | null> => {
  const found = Bun.which(bin, { PATH: [process.env.PATH ?? "", ...extraDirs].join(":") });
  return found ?? null;
};

export const fetchWithTimeout = async (url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> => {
  const { timeoutMs, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...rest, signal, redirect: "manual" });
};
