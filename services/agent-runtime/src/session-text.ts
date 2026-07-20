//
// Read the last assistant text out of a canonical pi session JSONL — used by
// automations (run summaries) and the goal driver (sentinel detection).
// Reads a bounded tail so giant sessions never get buffered whole.
//

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

/**
 * Last assistant message text in the session, or "" when none can be read.
 * Tolerates a truncated first line from the tail read.
 */
export function lastAssistantText(cwd: string, piSessionId: string): string {
  const filepath = findSessionFile(cwd, piSessionId);
  if (!filepath) return "";
  let raw: string;
  try {
    raw = readTail(filepath);
  } catch {
    return "";
  }
  let latest = "";
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
    const text = textFromContent(entry.message.content).trim();
    if (text) latest = text;
  }
  return latest;
}
