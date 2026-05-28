import { config as loadEnvironment } from "dotenv";
import { z } from "zod";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadPersistedConfig, type ProviderConfig } from "./persisted-config";

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
  exllamav3_command?: string;
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

  const cwd = process.cwd();
  const localDataDirectory = resolve(cwd, "data");
  const parentDataDirectory = resolve(cwd, "..", "data");
  const defaultDataDirectory =
    basename(cwd) === "controller" && existsSync(parentDataDirectory)
      ? parentDataDirectory
      : localDataDirectory;
  const defaultDatabasePath = resolve(defaultDataDirectory, "controller.db");

  const isLoopbackHost = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
  };

  const parseBooleanFlag = (value: string | undefined): boolean => {
    if (!value) return false;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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
    VLLM_STUDIO_HOST: z.string().default("127.0.0.1"),
    VLLM_STUDIO_PORT: z.coerce.number().int().positive().default(8080),
    VLLM_STUDIO_API_KEY: z.string().optional(),
    VLLM_STUDIO_ALLOW_UNAUTHENTICATED: z.string().optional(),
    VLLM_STUDIO_CORS_ORIGINS: z.string().optional(),
    VLLM_STUDIO_INFERENCE_HOST: z.string().default("localhost"),
    VLLM_STUDIO_INFERENCE_PORT: z.coerce.number().int().positive().default(8000),

    VLLM_STUDIO_DATA_DIR: z.string().default(defaultDataDirectory),
    VLLM_STUDIO_DB_PATH: z.string().default(defaultDatabasePath),
    VLLM_STUDIO_MODELS_DIR: z.string().default("/models"),
    VLLM_STUDIO_SGLANG_PYTHON: z.string().optional(),
    VLLM_STUDIO_TABBY_API_DIR: z.string().optional(),
    VLLM_STUDIO_LLAMA_BIN: z.string().optional(),
    VLLM_STUDIO_MLX_PYTHON: z.string().optional(),
    VLLM_STUDIO_EXLLAMAV3_COMMAND: z.string().optional(),
    VLLM_STUDIO_STRICT_OPENAI_MODELS: z.string().optional(),
  });

  const parsed = schema.parse(process.env);
  const host = parsed.VLLM_STUDIO_HOST.trim() || "127.0.0.1";

  const strictOpenAIModels = parsed.VLLM_STUDIO_STRICT_OPENAI_MODELS;
  const strictOpenAIModelsEnabled = strictOpenAIModels
    ? ["1", "true", "yes", "on"].includes(strictOpenAIModels.trim().toLowerCase())
    : false;

  const config: Config = {
    host,
    port: parsed.VLLM_STUDIO_PORT,
    inference_host: parsed.VLLM_STUDIO_INFERENCE_HOST.trim() || "localhost",
    inference_port: parsed.VLLM_STUDIO_INFERENCE_PORT,

    data_dir: resolve(parsed.VLLM_STUDIO_DATA_DIR),
    db_path: resolve(parsed.VLLM_STUDIO_DB_PATH),
    models_dir: resolve(parsed.VLLM_STUDIO_MODELS_DIR),
    strict_openai_models: strictOpenAIModelsEnabled,
    cors_origins: parseCorsOrigins(parsed.VLLM_STUDIO_CORS_ORIGINS),
    providers: [],
  };

  if (parsed.VLLM_STUDIO_API_KEY) {
    config.api_key = parsed.VLLM_STUDIO_API_KEY;
  }

  const allowUnauthenticated = parseBooleanFlag(parsed.VLLM_STUDIO_ALLOW_UNAUTHENTICATED);
  if (!config.api_key && !allowUnauthenticated && !isLoopbackHost(host)) {
    throw new Error(
      "VLLM_STUDIO_API_KEY is required when binding the controller to a non-loopback host. Set VLLM_STUDIO_ALLOW_UNAUTHENTICATED=true only for trusted local environments."
    );
  }

  if (parsed.VLLM_STUDIO_SGLANG_PYTHON) {
    config.sglang_python = parsed.VLLM_STUDIO_SGLANG_PYTHON;
  }
  if (parsed.VLLM_STUDIO_TABBY_API_DIR) {
    config.tabby_api_dir = parsed.VLLM_STUDIO_TABBY_API_DIR;
  }
  if (parsed.VLLM_STUDIO_LLAMA_BIN) {
    config.llama_bin = parsed.VLLM_STUDIO_LLAMA_BIN;
  }
  if (parsed.VLLM_STUDIO_MLX_PYTHON) {
    config.mlx_python = parsed.VLLM_STUDIO_MLX_PYTHON;
  }
  if (parsed.VLLM_STUDIO_EXLLAMAV3_COMMAND) {
    const command = parsed.VLLM_STUDIO_EXLLAMAV3_COMMAND.trim();
    if (command) {
      config.exllamav3_command = command;
    }
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
