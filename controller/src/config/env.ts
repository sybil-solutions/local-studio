import { config as loadEnvironment } from "dotenv";
import { z } from "zod";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

/**
 * Runtime configuration for the controller.
 */
export interface Config {
  host: string;
  port: number;
  api_key?: string;
  inference_port: number;
  data_dir: string;
  db_path: string;
  models_dir: string;
  sglang_python?: string;
  tabby_api_dir?: string;
}

/**
 * Load the closest .env file from current or parent directories.
 * @returns The loaded .env path or undefined.
 */
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

/**
 * Create a validated runtime configuration from environment variables.
 * @returns Validated configuration object.
 */
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

  const schema = z.object({
    VLLM_STUDIO_HOST: z.string().default("0.0.0.0"),
    VLLM_STUDIO_PORT: z.coerce.number().int().positive().default(8080),
    VLLM_STUDIO_API_KEY: z.string().optional(),
    VLLM_STUDIO_INFERENCE_PORT: z.coerce.number().int().positive().default(8000),
    VLLM_STUDIO_DATA_DIR: z.string().default(defaultDataDirectory),
    VLLM_STUDIO_DB_PATH: z.string().default(defaultDatabasePath),
    VLLM_STUDIO_MODELS_DIR: z.string().default("/models"),
    VLLM_STUDIO_SGLANG_PYTHON: z.string().optional(),
    VLLM_STUDIO_TABBY_API_DIR: z.string().optional(),
  });

  const parsed = schema.parse(process.env);

  const config: Config = {
    host: parsed.VLLM_STUDIO_HOST,
    port: parsed.VLLM_STUDIO_PORT,
    inference_port: parsed.VLLM_STUDIO_INFERENCE_PORT,
    data_dir: resolve(parsed.VLLM_STUDIO_DATA_DIR),
    db_path: resolve(parsed.VLLM_STUDIO_DB_PATH),
    models_dir: resolve(parsed.VLLM_STUDIO_MODELS_DIR),
  };

  if (parsed.VLLM_STUDIO_API_KEY) {
    config.api_key = parsed.VLLM_STUDIO_API_KEY;
  }
  if (parsed.VLLM_STUDIO_SGLANG_PYTHON) {
    config.sglang_python = parsed.VLLM_STUDIO_SGLANG_PYTHON;
  }
  if (parsed.VLLM_STUDIO_TABBY_API_DIR) {
    config.tabby_api_dir = parsed.VLLM_STUDIO_TABBY_API_DIR;
  }

  return config;
};
