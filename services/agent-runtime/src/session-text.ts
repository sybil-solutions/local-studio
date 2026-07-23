import { openSync, readSync, closeSync, statSync } from "node:fs";
import { findSessionFile } from "./sessions-store";
import { isRecord } from "../../../shared/agent/guards";

const TAIL_BYTES = 256 * 1024;

function readTail(filepath: string): string {
  const { size } = statSync(filepath);
  const start = Math.max(0, size - TAIL_BYTES);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(filepath, "r");
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return buffer.toString("utf8");
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : "",
    )
    .join("");
}

export type LastAssistantResult = {
  text: string;
  error: string | null;
};

export function lastAssistantResultFromJsonl(raw: string): LastAssistantResult {
  let text = "";
  let error: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "assistant") continue;
    const messageText = textFromContent(entry.message.content).trim();
    if (messageText) {
      text = messageText;
      error = null;
      continue;
    }
    if (typeof entry.message.errorMessage === "string" && entry.message.errorMessage.trim()) {
      error = entry.message.errorMessage.trim();
    }
  }
  return { text, error };
}

export function lastAssistantResult(cwd: string, piSessionId: string): LastAssistantResult {
  const filepath = findSessionFile(cwd, piSessionId);
  if (!filepath) return { text: "", error: null };
  try {
    return lastAssistantResultFromJsonl(readTail(filepath));
  } catch {
    return { text: "", error: null };
  }
}

export function lastAssistantText(cwd: string, piSessionId: string): string {
  return lastAssistantResult(cwd, piSessionId).text;
}
