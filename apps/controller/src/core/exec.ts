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
  signal?: AbortSignal;
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
  opts.signal?.addEventListener(
    "abort",
    () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
    },
    { once: true },
  );
  const max = opts.maxBytes ?? 16 * 1024 * 1024;
  const read = async (s: unknown): Promise<string> => {
    if (!(s instanceof ReadableStream)) return "";
    const text = await new Response(s).text().catch(() => "");
    return text.length > max ? text.slice(0, max) : text;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((res) => {
    timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      setTimeout(() => res(null), 1000).unref?.();
    }, opts.timeoutMs);
  });
  const done = Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
  const r = await Promise.race([done, expired]);
  clearTimeout(timer);
  const ms = performance.now() - t0;
  if (!r) return { code: null, stdout: "", stderr: `${cmd[0]} did not exit within ${opts.timeoutMs} ms`, timedOut: true, ms };
  const timedOut = proc.signalCode === "SIGKILL" && ms >= opts.timeoutMs;
  return { code: timedOut ? null : r[2], stdout: r[0], stderr: r[1], timedOut, ms };
};

export const fetchWithTimeout = async (url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> => {
  const { timeoutMs, ...rest } = init;
  const signal = rest.signal ? AbortSignal.any([rest.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...rest, signal, redirect: "manual" });
};

export const which = async (bin: string, extraDirs: string[] = []): Promise<string | null> => Bun.which(bin, { PATH: [process.env.PATH ?? "", ...extraDirs].join(":") }) ?? null;
