import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Harness } from "@local-studio/contracts";
import { HARNESSES } from "@local-studio/contracts";

export interface SessionSpec {
  id: string;
  harness: Harness;
  model: string;
  dir: string;
  bin: string;
  path: string;
  contextWindow: number | null;
  vision: boolean | null;
  gatewayUrl: string;
  safe: boolean;
  tmuxSession: string;
  startedAt: number;
}

export const SESSION_ID = /^ag_[0-9a-f]{8}$/;

export const expandDir = (dir: string): string => {
  const d = dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir === "~" ? homedir() : dir;
  return isAbsolute(d) ? resolve(d) : resolve(homedir(), d);
};

export const defaultDir = (home: string, harness: Harness) => join(home, "work", harness);

const specDir = (home: string) => join(home, "agents", "sessions");
const specPath = (home: string, id: string) => join(specDir(home), `${id}.json`);

export const newSessionId = () => `ag_${randomBytes(4).toString("hex")}`;

export const writeSpec = (home: string, s: SessionSpec) => {
  mkdirSync(specDir(home), { recursive: true, mode: 0o700 });
  const p = specPath(home, s.id);
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
};

export const readSpec = (home: string, id: string): SessionSpec | null => {
  if (!SESSION_ID.test(id)) return null;
  try {
    const s = JSON.parse(readFileSync(specPath(home, id), "utf8")) as SessionSpec;
    return (HARNESSES as readonly string[]).includes(s.harness) && s.id === id ? s : null;
  } catch {
    return null;
  }
};

export const listSpecs = (home: string): SessionSpec[] => {
  if (!existsSync(specDir(home))) return [];
  return readdirSync(specDir(home))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readSpec(home, f.slice(0, -5)))
    .filter((s): s is SessionSpec => s !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
};

export const forgetSpec = (home: string, id: string) => {
  if (SESSION_ID.test(id)) rmSync(specPath(home, id), { force: true });
};
