import type { DownloadFileInfo } from "../types";

// --- Glob matching (merged from download-globs.ts) ---

const escapeRegex = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const compileGlob = (pattern: string): RegExp => {
  const escaped = escapeRegex(pattern);
  const regex = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regex, "i");
};

const matchesAny = (value: string, patterns: string[]): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => compileGlob(pattern).test(value));
};

export type HuggingFaceModelInfo = {
  modelId?: string;
  sha?: string;
  siblings?: Array<{ rfilename: string; size?: number | null }>;
};

export const fetchHuggingFaceModelInfo = async (
  modelId: string,
  revision?: string | null,
  hfToken?: string | null
): Promise<HuggingFaceModelInfo> => {
  const encodedModelId = modelId.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`https://huggingface.co/api/models/${encodedModelId}`);
  if (revision) {
    url.searchParams.set("revision", revision);
  }
  const headers: Record<string, string> = {};
  if (hfToken) {
    headers["Authorization"] = `Bearer ${hfToken}`;
  }
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hugging Face API error: ${response.status} ${text}`);
  }
  return (await response.json()) as HuggingFaceModelInfo;
};

export const buildHuggingFaceFileList = (
  modelInfo: HuggingFaceModelInfo,
  allowPatterns: string[],
  ignorePatterns: string[]
): DownloadFileInfo[] => {
  const siblings = modelInfo.siblings ?? [];
  const files: DownloadFileInfo[] = [];
  for (const sibling of siblings) {
    const filename = sibling.rfilename;
    if (!filename) {
      continue;
    }
    if (matchesAny(filename, ignorePatterns)) {
      continue;
    }
    if (allowPatterns.length > 0 && !matchesAny(filename, allowPatterns)) {
      continue;
    }
    files.push({
      path: filename,
      size_bytes: typeof sibling.size === "number" ? sibling.size : null,
      downloaded_bytes: 0,
      status: "pending",
    });
  }
  return files;
};
