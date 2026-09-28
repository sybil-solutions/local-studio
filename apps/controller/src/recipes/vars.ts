import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FabricPort } from "@local-studio/probe";
import type { V2Recipe } from "./registry";
import { FORBIDDEN_ARG } from "./util";
import { hfHome } from "./weights";

const VAR = /\$\{([A-Z_][A-Z0-9_]*)(?::?-([^}]*))?\}/g;
const DEFAULT_PATH = "/usr/local/nvidia/bin:/usr/local/cuda/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SECRETS = ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "GITHUB_TOKEN"];

const POD_NAMES: Record<string, string[]> = {
  rank: ["NODE_RANK", "R"],
  head: ["HEAD_IP", "MASTER", "MASTER_ADDR", "HEAD_FABRIC_ADDRESS"],
  own: ["MIP", "NODE_IP", "VLLM_HOST_IP", "NODE_ROCE_IP"],
  ifname: ["MGMT_IF", "CX7_IF", "FABRIC_INTERFACE", "IFACE", "SOCKET_IFNAME", "NCCL_SOCKET_IFNAME"],
  hca: ["IB_HCA", "CX7_IB", "NCCL_IB_HCA"],
  gid: ["GID_INDEX", "GID", "NCCL_IB_GID_INDEX"],
  size: ["NNODES"],
  port: ["MPORT"],
  headless: ["HEADLESS"],
};

const MODEL_NAMES = ["MODEL", "MODEL_IN_CONTAINER", "MODEL_PATH_IN_CONTAINER", "MODEL_PATH"];
const DRAFT_NAMES = ["DRAFT_MODEL", "DRAFT_IN_CONTAINER", "DSPARK_PATH_IN_CONTAINER", "DRAFT_PATH_IN_CONTAINER"];
const BASE_NAMES = ["HF_HOME", "TRITON_CACHE_DIR", "FLASHINFER_CACHE_DIR", "WORK_DIR", "HOME", "HOST", "PORT", "CTX", "MAX_MODEL_LEN", "PATH", ...SECRETS];

export const podVars = ({ rank, size, head, own, hcas }: { rank: number; size: number; head: string; own: FabricPort; hcas: string[] }): Record<string, string> => {
  const put = (names: string[], v: string) => Object.fromEntries(names.map((n) => [n, v]));
  return {
    ...put(POD_NAMES.rank!, String(rank)),
    ...put(POD_NAMES.head!, head),
    ...put(POD_NAMES.own!, own.ip),
    ...put(POD_NAMES.ifname!, own.ifname),
    ...put(POD_NAMES.hca!, hcas.join(",")),
    ...(own.gid !== null ? put(POD_NAMES.gid!, String(own.gid)) : {}),
    ...put(POD_NAMES.size!, String(size)),
    ...put(POD_NAMES.port!, "29521"),
    ...put(POD_NAMES.headless!, rank > 0 ? "--headless" : ""),
  };
};

const hfToken = (): string | null => {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
  try {
    return readFileSync(join(hfHome(), "token"), "utf8").trim() || null;
  } catch {
    return null;
  }
};

const literalEnv = (r: V2Recipe): Record<string, string> => Object.fromEntries(Object.entries(r.launch.environment ?? {}).filter(([, v]) => !String(v).includes("${")).map(([k, v]) => [k, String(v)]));

export const fillWith =
  (known: Record<string, string>) =>
  (t: string): string =>
    t.replace(VAR, (m, k: string, d?: string) => known[k] ?? d ?? m);

export const unfilled = (texts: string[]): string[] => [...new Set(texts.join(" ").match(/\$\{[A-Z_][A-Z0-9_]*\}/g) ?? [])];

const modelRef = (w: V2Recipe["weights"][number] | undefined, fill: (t: string) => string): string | null => {
  if (!w) return null;
  const at = fill(w.mountPath);
  return w.layout === "hub" ? `${at}/hub/models--${w.repository.replace("/", "--")}/snapshots/${w.revision}` : at;
};

export const launchVars = (r: V2Recipe, o: { dataDir: string; recipeId: string; pod?: Record<string, string> }): Record<string, string> => {
  const token = hfToken();
  const base: Record<string, string> = {
    HF_HOME: hfHome(),
    TRITON_CACHE_DIR: join(o.dataDir, "cache", "triton"),
    FLASHINFER_CACHE_DIR: join(o.dataDir, "cache", "flashinfer"),
    WORK_DIR: join(o.dataDir, "work", o.recipeId),
    HOME: process.env.HOME ?? "",
    HOST: "0.0.0.0",
    PORT: String(r.launch.port),
    CTX: String(r.serving.ctxTokens),
    MAX_MODEL_LEN: String(r.serving.ctxTokens),
    PATH: DEFAULT_PATH,
    ...(token ? { HF_TOKEN: token, HUGGING_FACE_HUB_TOKEN: token } : {}),
  };
  const known = { ...base, ...literalEnv(r), ...(o.pod ?? {}) };
  const fill = fillWith(known);
  const model = modelRef(r.weights[0], fill);
  const draft = modelRef(r.weights[1], fill);
  return {
    ...(model ? Object.fromEntries(MODEL_NAMES.map((n) => [n, model])) : {}),
    ...(draft ? Object.fromEntries(DRAFT_NAMES.map((n) => [n, draft])) : {}),
    ...known,
  };
};

export const dropUnsetSecrets = (env: Record<string, string>): void => {
  for (const [k, v] of Object.entries(env)) if (SECRETS.some((s) => v.includes(`\${${s}}`))) delete env[k];
};

export const missingVars = (r: V2Recipe): string[] => {
  const can = new Set([...BASE_NAMES, ...Object.keys(literalEnv(r)), ...(r.weights[0] ? MODEL_NAMES : []), ...(r.weights[1] ? DRAFT_NAMES : []), ...((r.machines ?? 1) > 1 ? Object.values(POD_NAMES).flat() : [])]);
  const texts = r.host ? [...r.host.command, ...Object.values(r.host.env)] : [...r.launch.arguments, ...Object.values(r.launch.environment ?? {}).map(String), ...(r.launch.docker ?? []), ...(r.launch.mounts ?? []).map((m) => m.source), r.launch.entrypoint ?? "", ...r.weights.map((w) => w.mountPath)];
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(VAR)) if (m[2] === undefined && !can.has(m[1]!)) out.add(m[1]!);
  return [...out];
};

export const blockedReason = (r: V2Recipe): string | null => {
  const miss = missingVars(r);
  if (miss.length) return `needs ${miss.join(", ")}, which its publisher's setup script makes`;
  const hay = r.host ? [...r.host.command, ...Object.values(r.host.env)] : [r.launch.entrypoint ?? "", ...r.launch.arguments, ...Object.values(r.launch.environment ?? {}).map(String)];
  if (FORBIDDEN_ARG.test(hay.join(" "))) return "turns off CUDA graphs (enforce-eager), which Local Studio does not run";
  return null;
};
