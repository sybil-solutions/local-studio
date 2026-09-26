export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const RECIPE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
export const DIGEST_PINNED = /@sha256:[0-9a-f]{64}$/;
export const REVISION_40 = /^[0-9a-f]{40}$/;
export const FORBIDDEN_ARG = /enforce.eager|disable.?cuda.?graph/i;
export const DOCKER_OPT = /^--(init|ipc=host|oom-score-adj=-?\d{1,4}|ulimit=(memlock|stack)=-?\d{1,12}(:-?\d{1,12})?|security-opt=seccomp=(unconfined|\/[\w./-]+\.json))$/;
export const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
export const DEVICE_ENV = new Set(["NVIDIA_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES"]);
export const SECRET_ENV = /(_KEY|_TOKEN|_SECRET|_SECRETS)$|^HF_TOKEN$|PASSWORD|PASSWD|CREDENTIAL|^AWS_SECRET|API_?KEY/i;
export const SECRET_FLAG = /^--?([a-z0-9]+-)*(api-?key|key|token|secret|password|passwd)$/i;

export const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
};

export const stableJson = (v: unknown): string => `${JSON.stringify(sortKeys(v), null, 2)}\n`;

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

export const normHardware = (name: string): string =>
  name.toLowerCase().replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|[0-9]+gb|[^a-z0-9]/g, "");

export const argValue = (argv: string[], ...names: string[]): string | null => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    for (const n of names) {
      if (a === n) return argv[i + 1] ?? null;
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1);
    }
  }
  return null;
};

export const argValues = (argv: string[], name: string): string[] => {
  const i = argv.indexOf(name);
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !(argv[j] ?? "").startsWith("--"); j++) out.push(argv[j] ?? "");
  return out;
};

export const intOrNull = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export { parseJson } from "../discovery/util";

export const scrubArgv = (argv: string[]): { argv: string[]; dropped: string[] } => {
  const out: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const eq = a.indexOf("=");
    const flag = eq > 0 ? a.slice(0, eq) : a;
    if (SECRET_FLAG.test(flag)) {
      dropped.push(flag);
      if (eq < 0 && i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("-")) i++;
      continue;
    }
    out.push(a);
  }
  return { argv: out, dropped };
};

export const nowStamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

export const isoSeconds = (d = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");
