import { config as loadEnvironment } from "dotenv";
import { z } from "zod";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPersistedConfig, type ProviderConfig } from "./persisted-config";
import { parseBooleanFlag } from "../core/validation";

export interface Config {
  host: string;
  port: number;
  api_key?: string;
  cors_origins?: string[];
  inference_host: string;
  inference_port: number;

  data_dir: string;
  db_path: string;
  models_dir: string;
  sglang_python?: string;
  tabby_api_dir?: string;
  llama_bin?: string;
  mlx_python?: string;
  strict_openai_models: boolean;
  providers: ProviderConfig[];
}

export const loadDotEnvironment = (): string | undefined => {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), "..", "..", ".env"),
  ];

  const envPath = candidates.find((pathValue) => existsSync(pathValue));
  if (envPath) {
    loadEnvironment({ path: envPath });
  }
  return envPath;
};

export const createConfig = (): Config => {
  loadDotEnvironment();

  // Anchor defaults to the controller package root (two levels up from src/config/)
  // so the data dir lands at <repo>/data regardless of the cwd the process started from.
  const controllerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const defaultDataDirectory = resolve(controllerRoot, "..", "data");

  const isLoopbackHost = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
  };

  const normalizeOrigin = (value: string): string | null => {
    try {
      const origin = new URL(value.trim()).origin;
      return origin === "null" ? null : origin;
    } catch {
      return null;
    }
  };

  const parseCorsOrigins = (value: string | undefined): string[] => {
    const defaults = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://host.docker.internal:3000",
      "http://host.docker.internal:3001",
    ];
    const candidates =
      value && value.trim().length > 0 ? value.split(",").map((entry) => entry.trim()) : defaults;
    return [
      ...new Set(
        candidates
          .map((entry) => normalizeOrigin(entry))
          .filter((entry): entry is string => Boolean(entry))
      ),
    ];
  };

  const schema = z.object({
    LOCAL_STUDIO_HOST: z.string().default("127.0.0.1"),
    LOCAL_STUDIO_PORT: z.coerce.number().int().positive().default(8080),
    LOCAL_STUDIO_API_KEY: z.string().optional(),
    LOCAL_STUDIO_ALLOW_UNAUTHENTICATED: z.string().optional(),
    LOCAL_STUDIO_CORS_ORIGINS: z.string().optional(),
    LOCAL_STUDIO_INFERENCE_HOST: z.string().default("localhost"),
    LOCAL_STUDIO_INFERENCE_PORT: z.coerce.number().int().positive().default(8000),

    LOCAL_STUDIO_DATA_DIR: z.string().default(defaultDataDirectory),
    LOCAL_STUDIO_DB_PATH: z.string().optional(),
    LOCAL_STUDIO_MODELS_DIR: z.string().default("/models"),
    LOCAL_STUDIO_SGLANG_PYTHON: z.string().optional(),
    LOCAL_STUDIO_TABBY_API_DIR: z.string().optional(),
    LOCAL_STUDIO_LLAMA_BIN: z.string().optional(),
    LOCAL_STUDIO_MLX_PYTHON: z.string().optional(),
    LOCAL_STUDIO_STRICT_OPENAI_MODELS: z.string().optional(),
  });

  const parsed = schema.parse(process.env);
  const host = parsed.LOCAL_STUDIO_HOST.trim() || "127.0.0.1";

  const strictOpenAIModelsEnabled = parseBooleanFlag(parsed.LOCAL_STUDIO_STRICT_OPENAI_MODELS);

  // The db default follows the resolved data dir so overriding LOCAL_STUDIO_DATA_DIR
  // alone keeps the database inside it.
  const dataDirectory = resolve(parsed.LOCAL_STUDIO_DATA_DIR);
  const databasePath = resolve(parsed.LOCAL_STUDIO_DB_PATH ?? resolve(dataDirectory, "controller.db"));

  const config: Config = {
    host,
    port: parsed.LOCAL_STUDIO_PORT,
    inference_host: parsed.LOCAL_STUDIO_INFERENCE_HOST.trim() || "localhost",
    inference_port: parsed.LOCAL_STUDIO_INFERENCE_PORT,

    data_dir: dataDirectory,
    db_path: databasePath,
    models_dir: resolve(parsed.LOCAL_STUDIO_MODELS_DIR),
    strict_openai_models: strictOpenAIModelsEnabled,
    cors_origins: parseCorsOrigins(parsed.LOCAL_STUDIO_CORS_ORIGINS),
    providers: [],
  };

  if (parsed.LOCAL_STUDIO_API_KEY) {
    config.api_key = parsed.LOCAL_STUDIO_API_KEY;
  }

  const allowUnauthenticated = parseBooleanFlag(parsed.LOCAL_STUDIO_ALLOW_UNAUTHENTICATED);
  if (!config.api_key && !allowUnauthenticated && !isLoopbackHost(host)) {
    throw new Error(
      "LOCAL_STUDIO_API_KEY is required when binding the controller to a non-loopback host. Set LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true only for trusted local environments."
    );
  }

  if (parsed.LOCAL_STUDIO_SGLANG_PYTHON) {
    config.sglang_python = parsed.LOCAL_STUDIO_SGLANG_PYTHON;
  }
  if (parsed.LOCAL_STUDIO_TABBY_API_DIR) {
    config.tabby_api_dir = parsed.LOCAL_STUDIO_TABBY_API_DIR;
  }
  if (parsed.LOCAL_STUDIO_LLAMA_BIN) {
    config.llama_bin = parsed.LOCAL_STUDIO_LLAMA_BIN;
  }
  if (parsed.LOCAL_STUDIO_MLX_PYTHON) {
    config.mlx_python = parsed.LOCAL_STUDIO_MLX_PYTHON;
  }

  const persisted = loadPersistedConfig(config.data_dir);
  if (persisted.models_dir) {
    config.models_dir = resolve(persisted.models_dir);
  }

  if (Array.isArray(persisted.providers)) {
    config.providers = persisted.providers;
  }

  return config;
};
