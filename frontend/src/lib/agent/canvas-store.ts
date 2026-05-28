import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

export type AgentCanvasDocument = {
  enabled: boolean;
  text: string;
  updatedAt: string;
};

const DEFAULT_CANVAS: AgentCanvasDocument = {
  enabled: false,
  text: "",
  updatedAt: "",
};

function legacyCanvasFilePath(): string {
  return path.join(resolveDataDir(), "agent-canvas.json");
}

function sanitizeSessionId(sessionId: string | null | undefined): string | null {
  if (typeof sessionId !== "string") return null;
  const trimmed = sessionId.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(trimmed)) return null;
  return trimmed;
}

function canvasFilePath(sessionId: string | null | undefined): string {
  const id = sanitizeSessionId(sessionId);
  if (!id) return legacyCanvasFilePath();
  return path.join(resolveDataDir(), "agent-canvas", `${id}.json`);
}

function normalizeCanvas(input: unknown): AgentCanvasDocument {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    enabled: value.enabled === true,
    text: typeof value.text === "string" ? value.text : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function readAgentCanvas(sessionId?: string | null): Promise<AgentCanvasDocument> {
  try {
    return normalizeCanvas(JSON.parse(await readFile(canvasFilePath(sessionId), "utf8")));
  } catch {
    return DEFAULT_CANVAS;
  }
}

export async function writeAgentCanvas(
  patch: Partial<Pick<AgentCanvasDocument, "enabled" | "text">>,
  sessionId?: string | null,
): Promise<AgentCanvasDocument> {
  const current = await readAgentCanvas(sessionId);
  const next: AgentCanvasDocument = {
    ...current,
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.text === "string" ? { text: patch.text } : {}),
    updatedAt: new Date().toISOString(),
  };
  const filePath = canvasFilePath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
