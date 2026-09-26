import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { hostname, homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Platform } from "@local-studio/contracts";

export interface Config {
  version: string;
  host: string;
  port: number;
  publicUrl: string;
  dataDir: string;
  home: string;
  modelsDir: string;
  registryDir: string;
  registryRepo: string;
  registryUrl: string;
  readOnly: boolean;
  name: string;
  platform: Platform;
  tz: string;
  uiDir: string | null;
  extraScanPorts: number[];
  watchdogPatterns: string[];
  managedPortRange: [number, number];
  apiKeyOverride: string | null;
}

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
};

const bool = (v: string | undefined): boolean => v === "1" || v === "true" || v === "yes";

const expand = (p: string): string => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

const findUiDir = (): string | null => {
  const candidates = [
    process.env.LOCAL_STUDIO_UI_DIR,
    join(dirname(process.execPath), "ui"),
    resolve(import.meta.dir, "../../../ui/dist"),
  ].filter((x): x is string => !!x);
  return candidates.find((d) => existsSync(join(d, "index.html"))) ?? null;
};

const readVersion = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.LOCAL_STUDIO_VERSION ?? "0.0.0";
  }
};

export const loadConfig = (argv: string[]): Config => {
  const env = process.env;
  const home = expand(flag(argv, "home") ?? env.LOCAL_STUDIO_HOME ?? "~/.local-studio");
  const dataDir = expand(flag(argv, "data-dir") ?? env.LOCAL_STUDIO_DATA_DIR ?? join(home, "data"));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const host = flag(argv, "host") ?? env.LOCAL_STUDIO_HOST ?? "127.0.0.1";
  const port = Number(flag(argv, "port") ?? env.LOCAL_STUDIO_PORT ?? 8080);
  const modelsDefault = existsSync("/mnt/llm_models") ? "/mnt/llm_models" : join(home, "models");
  const plat: Platform = platform() === "darwin" ? "darwin" : "linux";
  return {
    version: readVersion(),
    host,
    port,
    publicUrl: env.LOCAL_STUDIO_PUBLIC_URL ?? `http://${host === "0.0.0.0" ? hostname() : host}:${port}`,
    dataDir,
    home,
    modelsDir: expand(flag(argv, "models-dir") ?? env.LOCAL_STUDIO_MODELS_DIR ?? modelsDefault),
    registryDir: expand(env.LOCAL_STUDIO_REGISTRY_DIR ?? join(home, "registry")),
    registryRepo: env.LOCAL_STUDIO_REGISTRY_REPO ?? "0xSero/local-ai-registry",
    registryUrl: env.LOCAL_STUDIO_REGISTRY_URL ?? "https://github.com/0xSero/local-ai-registry.git",
    readOnly: argv.includes("--read-only") || bool(env.LOCAL_STUDIO_READ_ONLY),
    name: flag(argv, "name") ?? env.LOCAL_STUDIO_NAME ?? hostname().split(".")[0] ?? hostname(),
    platform: plat,
    tz: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    uiDir: findUiDir(),
    extraScanPorts: (env.LOCAL_STUDIO_SCAN_PORTS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 65536),
    watchdogPatterns: (env.LOCAL_STUDIO_WATCHDOGS ?? "keep-serving.py,forge.py").split(",").map((s) => s.trim()).filter(Boolean),
    managedPortRange: [12434, 12499],
    apiKeyOverride: env.LOCAL_STUDIO_API_KEY ?? null,
  };
};

export const readOrCreateSecretFile = (path: string, make: () => string): string => {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const v = make();
  writeFileSync(path, `${v}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return v;
};
