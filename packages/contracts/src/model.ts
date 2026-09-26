import type { GpuKey } from "./gpu";
import type { MachineId } from "./machine";

export type Engine = "vllm" | "sglang" | "llamacpp" | "tabby" | "mlx" | "openai";

export type ModelState = "loading" | "ready" | "unhealthy" | "stopping";

export type ModelOrigin = "managed" | "adopted";

export type Dialect = "chat" | "responses" | "messages";

export type RuntimeRef =
  | {
      kind: "docker";
      containerId: string;
      containerName: string;
      image: string;
      imageDigest: string | null;
      statePid: number;
      labels: Record<string, string>;
      mounts: { source: string; target: string; readOnly: boolean }[];
    }
  | { kind: "native"; pid: number; startTime: string; exe: string }
  | { kind: "external"; note: string };

export interface CacheInfo {
  prefixCaching: boolean | null;
  blockSize: number | null;
  kvCacheTokens: number | null;
  kvCacheDtype: string | null;
  maxConcurrency: number | null;
}

export interface SpecDecodeInfo {
  method: string;
  numSpeculativeTokens: number | null;
}

export interface RunningModel {
  id: string;
  machineId: MachineId;
  engine: Engine;
  engineVersion: string | null;
  state: ModelState;
  stateSince: number;
  origin: ModelOrigin;
  recipeId: string | null;
  servedModels: string[];
  primaryModel: string;
  contextWindow: number | null;
  vision: boolean | null;
  port: number;
  baseUrl: string;
  metricsUrl: string | null;
  nativeDialects: Dialect[];
  runtime: RuntimeRef;
  argv: string[];
  gpuKeys: GpuKey[];
  vramUsedMiB: number | null;
  startedAt: number | null;
  cache: CacheInfo | null;
  spec: SpecDecodeInfo | null;
  watchdog: string | null;
  error: string | null;
  stopBlocked: string | null;
  embedding: boolean;
  quant?: string | null;
  quantFrom?: QuantFrom | null;
}

export type EndpointKind = "auth-proxy" | "openai-proxy" | "unknown-http";

export interface Endpoint {
  port: number;
  bind: string;
  kind: EndpointKind;
  pid: number | null;
  process: string | null;
  note: string;
}

export interface GatewayModel {
  id: string;
  machineId: MachineId;
  machineName: string;
  modelId: string;
  engine: Engine;
  state: ModelState;
  contextWindow: number | null;
  vision: boolean | null;
  via: "local" | "peer";
}

export type QuantFrom = "flag" | "config" | "name";

const QUANT_FLAG: Record<string, string> = {
  modelopt_mixed: "ModelOpt mixed",
  modelopt_fp4: "ModelOpt NVFP4",
  modelopt: "ModelOpt",
  awq_marlin: "AWQ",
  gptq_marlin: "GPTQ",
  "compressed-tensors": "compressed-tensors",
  bitsandbytes: "bitsandbytes",
  "auto-round": "AutoRound",
  auto_round: "AutoRound",
};

const upper = (s: string) => s.replace(/_/g, " ").toUpperCase();

const flagAt = (argv: string[], names: string[]): string | null => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    for (const n of names) {
      if (a === n) return argv[i + 1] && !argv[i + 1]!.startsWith("-") ? argv[i + 1]! : null;
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
    }
  }
  return null;
};

export const modelPathArg = (argv: string[]): string | null => {
  const i = argv.indexOf("serve");
  const p = i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("-") ? argv[i + 1]! : flagAt(argv, ["--model", "--model-path", "-m"]);
  return p || null;
};

export const quantFromFlag = (argv: string[]): string | null => {
  const q = flagAt(argv, ["--quantization", "-q"]);
  return q ? (QUANT_FLAG[q.toLowerCase()] ?? upper(q)) : null;
};

type QuantConfig = { quant_method?: string; bits?: number; w_bit?: number; weight_bits?: number; quant_algo?: string; config_groups?: Record<string, { weights?: { num_bits?: number }; input_activations?: { num_bits?: number } | null }> };

export const quantFromConfig = (cfg: unknown): string | null => {
  const c = cfg as { quantization_config?: QuantConfig; compression_config?: QuantConfig } | null;
  const q = c?.quantization_config ?? c?.compression_config;
  const method = q?.quant_method?.toLowerCase();
  if (!q || !method) return null;
  const bits = q.bits ?? q.w_bit ?? q.weight_bits ?? null;
  if (method === "exl3" || method === "exl2") return `${method.toUpperCase()}${bits ? ` ${bits} bpw` : ""}`;
  if (method === "modelopt") return `ModelOpt${q.quant_algo ? ` ${q.quant_algo.replace(/_/g, " ")}` : ""}`;
  if (method === "compressed-tensors") {
    const g = Object.values(q.config_groups ?? {})[0];
    const w = g?.weights?.num_bits;
    return `compressed-tensors${w ? ` W${w}A${g?.input_activations?.num_bits ?? 16}` : ""}`;
  }
  const name = QUANT_FLAG[method] ?? upper(method);
  return bits && method !== "fp8" && method !== "mxfp4" ? `${name} INT${bits}` : name;
};

const NAME_TOKENS: [RegExp, string][] = [
  [/nvfp4/i, "NVFP4"],
  [/mxfp4/i, "MXFP4"],
  [/mxfp8/i, "MXFP8"],
  [/(^|[^a-z])awq([^a-z]|$)/i, "AWQ"],
  [/gptq/i, "GPTQ"],
  [/auto-?round/i, "AutoRound"],
  [/w4a16/i, "W4A16"],
  [/w8a8/i, "W8A8"],
  [/(^|[^a-z])fp8([^a-z]|$)/i, "FP8"],
  [/(^|[^a-z])int4([^a-z]|$)/i, "INT4"],
  [/(^|[^a-z])int8([^a-z]|$)/i, "INT8"],
];

export const quantFromName = (names: string[]): string | null => {
  const s = names.join(" ");
  const exl = /exl([23])/i.exec(s);
  if (exl) {
    const bpw = /(\d+(?:\.\d+)?)\s*bpw/i.exec(s);
    return `EXL${exl[1]}${bpw ? ` ${Number(bpw[1])} bpw` : ""}`;
  }
  const gguf = /(?:^|[^A-Za-z0-9])(I?Q\d(?:_[A-Z0-9]{1,2}){0,2})(?:[^A-Za-z0-9]|$)/.exec(s);
  if (gguf || /\.gguf/i.test(s)) return `GGUF${gguf ? ` ${gguf[1]}` : ""}`;
  const hits = NAME_TOKENS.filter(([re]) => re.test(s)).map(([, t]) => t);
  return hits.length ? [...new Set(hits)].slice(0, 2).join(" ") : null;
};

export const quantNames = (m: Pick<RunningModel, "argv" | "primaryModel" | "servedModels" | "runtime">): string[] => {
  const p = modelPathArg(m.argv);
  const mounts = m.runtime.kind === "docker" && p ? m.runtime.mounts.filter((x) => p === x.target || p.startsWith(`${x.target}/`)).map((x) => x.source) : [];
  return [m.primaryModel, ...m.servedModels, ...(p ? [p] : []), ...mounts];
};

export const quantOf = (m: Pick<RunningModel, "argv" | "primaryModel" | "servedModels" | "runtime" | "quant" | "quantFrom">): { label: string | null; from: QuantFrom | null } => {
  if (m.quant !== undefined) return { label: m.quant, from: m.quantFrom ?? null };
  const f = quantFromFlag(m.argv);
  if (f) return { label: f, from: "flag" };
  const n = quantFromName(quantNames(m));
  return { label: n, from: n ? "name" : null };
};

export const kvDtypeOf = (m: Pick<RunningModel, "argv" | "cache">): string | null => {
  const v = m.cache?.kvCacheDtype ?? flagAt(m.argv, ["--kv-cache-dtype", "--cache-type-k"]);
  return v && v !== "auto" ? v : null;
};
