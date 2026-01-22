import { statSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Model metadata information.
 */
export interface ModelInfo {
  name: string;
  path: string;
  size_bytes: number | null;
  modified_at: number | null;
  architecture: string | null;
  quantization: string | null;
  context_length: number | null;
  recipe_ids: string[];
  has_recipe: boolean;
}

const WEIGHT_EXTS = [".safetensors", ".bin", ".gguf"] as const;
const CONFIG_FILENAMES = ["config.json"] as const;

/**
 * Check if a directory looks like a model directory.
 * @param path - Directory path.
 * @returns True if it appears to be a model directory.
 */
export const looksLikeModelDirectory = (path: string): boolean => {
  if (!existsSync(path)) {
    return false;
  }
  try {
    const entries = readdirSync(path, { withFileTypes: true });
    for (const configName of CONFIG_FILENAMES) {
      if (entries.some((entry) => entry.isFile() && entry.name === configName)) {
        return true;
      }
    }
    return entries.some(
      (entry) => entry.isFile() && WEIGHT_EXTS.some((extension) => entry.name.toLowerCase().endsWith(extension)),
    );
  } catch {
    return false;
  }
};

/**
 * Infer quantization from model name.
 * @param name - Model directory name.
 * @returns Quantization identifier.
 */
export const inferQuantization = (name: string): string | undefined => {
  const lower = name.toLowerCase();
  const candidates = ["awq", "gptq", "gguf", "fp16", "bf16", "int8", "int4", "w4a16", "w8a16"];
  return candidates.find((value) => lower.includes(value));
};

/**
 * Read config metadata from config.json.
 * @param modelDirectory - Model directory.
 * @returns Metadata object.
 */
export const readConfigMetadata = (modelDirectory: string): { architecture: string | null; context_length: number | null } => {
  const configPath = join(modelDirectory, "config.json");
  if (!existsSync(configPath)) {
    return { architecture: null, context_length: null };
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const architectures = parsed["architectures"];
    const architecture = Array.isArray(architectures) && architectures.length > 0
      ? String(architectures[0])
      : null;
    const contextLengthRaw =
      parsed["max_position_embeddings"] ||
      parsed["max_seq_len"] ||
      parsed["seq_length"] ||
      parsed["n_ctx"];
    const contextLength = typeof contextLengthRaw === "number"
      ? contextLengthRaw
      : typeof contextLengthRaw === "string" && /^\d+$/.test(contextLengthRaw)
        ? Number(contextLengthRaw)
        : null;
    return { architecture, context_length: contextLength };
  } catch {
    return { architecture: null, context_length: null };
  }
};

/**
 * Estimate weight size for a model directory.
 * @param modelDirectory - Model directory.
 * @param recursive - Whether to scan recursively.
 * @returns Total size in bytes.
 */
export const estimateWeightsSizeBytes = (modelDirectory: string, recursive: boolean): number | null => {
  let total = 0;
  try {
    const entries = readdirSync(modelDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && recursive) {
        const nested = estimateWeightsSizeBytes(join(modelDirectory, entry.name), true);
        total += nested ?? 0;
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!WEIGHT_EXTS.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
        continue;
      }
      try {
        const stats = statSync(join(modelDirectory, entry.name));
        total += stats.size;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return total || null;
};

/**
 * Discover model directories under provided roots.
 * @param roots - Root paths.
 * @param maxDepth - Maximum depth.
 * @param maxModels - Maximum models to return.
 * @returns List of model directory paths.
 */
export const discoverModelDirectories = (
  roots: string[],
  maxDepth = 1,
  maxModels = 500,
): string[] => {
  const discovered: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = roots
    .filter((root) => Boolean(root))
    .map((root) => ({ path: root, depth: 0 }));

  while (queue.length > 0 && discovered.length < maxModels) {
    const entry = queue.shift();
    if (!entry) {
      break;
    }
    const current = entry.path;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (looksLikeModelDirectory(current)) {
      discovered.push(current);
      continue;
    }

    if (entry.depth >= maxDepth) {
      continue;
    }

    try {
      const children = readdirSync(current, { withFileTypes: true });
      for (const child of children) {
        if (!child.isDirectory() || child.name.startsWith(".")) {
          continue;
        }
        queue.push({ path: join(current, child.name), depth: entry.depth + 1 });
      }
    } catch {
      continue;
    }
  }

  return discovered;
};

/**
 * Build model info object for a directory.
 * @param modelDirectory - Model directory.
 * @param recipeIds - Associated recipe ids.
 * @returns Model info.
 */
export const buildModelInfo = async (modelDirectory: string, recipeIds: string[] = []): Promise<ModelInfo> => {
  const metadata = await readConfigMetadata(modelDirectory);
  let modifiedAt: number | undefined;
  try {
    modifiedAt = statSync(modelDirectory).mtimeMs;
  } catch {
    modifiedAt = undefined;
  }
  const name = modelDirectory.split("/").pop() ?? modelDirectory;
  return {
    name,
    path: modelDirectory,
    size_bytes: estimateWeightsSizeBytes(modelDirectory, false),
    modified_at: modifiedAt ?? null,
    architecture: metadata.architecture,
    quantization: inferQuantization(name) ?? null,
    context_length: metadata.context_length,
    recipe_ids: [...new Set(recipeIds)].sort(),
    has_recipe: recipeIds.length > 0,
  };
};
