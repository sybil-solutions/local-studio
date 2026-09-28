import type { Sys } from "@local-studio/probe";
export const ENGINE_RE =
  /(^|[\/\s])vllm-mlx\s+serve\b|(^|[\/\s])vllm\s+serve\b|\bvllm\.entrypoints\.|\s-m\s+vllm(\.|\s|$)|sglang\.launch_server|\s-m\s+sglang(\.|\s|$)|(^|[\/\s])sglang\s+serve\b|(^|\/)llama-server(\s|$)|tabbyAPI|mlx_lm[.\s]server|(^|[\/\s])mlx_lm\.server/;

export const engineFromArgs = (args: string): "vllm" | "sglang" | "llamacpp" | "tabby" | "mlx" | null => {
  if (/vllm-mlx|mlx_lm/.test(args)) return "mlx";
  if (/sglang/.test(args)) return "sglang";
  if (/llama-server/.test(args)) return "llamacpp";
  if (/tabbyAPI/i.test(args)) return "tabby";
  if (/vllm/.test(args)) return "vllm";
  return null;
};

export const embeddingArgv = (argv: string[]): boolean =>
  argv.some((a) => a === "--embedding" || a === "--embeddings" || a === "--task=embed" || a === "--is-embedding" || a === "--runner=pooling") ||
  (argv.includes("--task") && argv[argv.indexOf("--task") + 1] === "embed") ||
  (argv.includes("--runner") && argv[argv.indexOf("--runner") + 1] === "pooling");

const STT = /(^|[^a-z])(asr|stt|whisper|parakeet|canary|transcri)/i;
const TTS = /(^|[^a-z])(tts|s2-pro|fish[-_]?speech|kokoro|orpheus|csm|sesame|voxtral-tts)/i;

export const modalityOf = (argv: string[], names: string[]): "chat" | "embedding" | "stt" | "tts" => {
  if (embeddingArgv(argv)) return "embedding";
  const hay = [...names, ...argv.filter((a) => a.includes("/") || !a.startsWith("-"))].join(" ");
  if (TTS.test(hay) || (argv.some((a) => a.endsWith("vllm-omni")) && /fish|tts|s2/i.test(hay))) return "tts";
  if (STT.test(hay)) return "stt";
  return "chat";
};

const PORT_ARG = /(?:^|\s)--port(?:=|\s+)(\d+)(?:\s|$)/;

export const portArg = (args: string): number | null => {
  const m = PORT_ARG.exec(args);
  return m ? Number(m[1]) : null;
};

export const pool = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

const FLAG_ALIASES: Record<string, string[]> = {
  served: ["--served-model-name"],
  ctx: ["--max-model-len", "--context-length", "-c", "--ctx-size"],
  tp: ["--tensor-parallel-size", "-tp", "--tp-size", "--tp"],
  spec: ["--speculative-config"],
  kvDtype: ["--kv-cache-dtype", "--cache-type-k"],
  maxSeqs: ["--max-num-seqs", "--max-running-requests", "-np", "--parallel"],
  port: ["--port"],
  mm: ["--limit-mm-per-prompt"],
};

export const flagValues = (argv: string[], names: string[]): string[] | null => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    for (const n of names) {
      if (a === n) {
        const vals: string[] = [];
        for (let j = i + 1; j < argv.length && !(argv[j] as string).startsWith("-"); j++) vals.push(argv[j] as string);
        return vals;
      }
      if (a.startsWith(`${n}=`)) return [a.slice(n.length + 1)];
    }
  }
  return null;
};

export const flag = (argv: string[], key: keyof typeof FLAG_ALIASES): string | null => flagValues(argv, FLAG_ALIASES[key] ?? [])?.[0] ?? null;

export const flagList = (argv: string[], key: keyof typeof FLAG_ALIASES): string[] => flagValues(argv, FLAG_ALIASES[key] ?? []) ?? [];

export const hasFlag = (argv: string[], name: string): boolean => argv.some((a) => a === name || a.startsWith(`${name}=`));

export const num = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export const parseJson = <T = unknown>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export const envMap = (env: string[] | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const kv of env ?? []) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
};

export const promLabels = (text: string, metric: string): Record<string, string> | null => {
  const re = new RegExp(`^${metric.replace(/[:.]/g, (m) => `\\${m}`)}\\{([^}]*)\\}`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const p of (m[1] ?? "").matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) out[p[1] as string] = p[2] as string;
  return out;
};

export const sysOf = (ctx: { config: { platform: string }; exec: Sys["exec"] }): Sys => ({ platform: ctx.config.platform, exec: ctx.exec });
