// CRITICAL
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AgentFS } from "agentfs-sdk";
import type { AppContext } from "../types/context";

const agentFsCache = new Map<string, Promise<AgentFS>>();

const ensureAgentFsRoot = (context: AppContext): string => {
  const root = resolve(context.config.data_dir, "agentfs");
  mkdirSync(root, { recursive: true });
  return root;
};

export const getAgentFs = (context: AppContext, sessionId: string): Promise<AgentFS> => {
  const root = ensureAgentFsRoot(context);
  const dbPath = resolve(root, `${sessionId}.db`);
  const cached = agentFsCache.get(dbPath);
  if (cached) return cached;

  const opened = AgentFS.open({ id: sessionId, path: dbPath }).catch((error) => {
    agentFsCache.delete(dbPath);
    throw error;
  });
  agentFsCache.set(dbPath, opened);
  return opened;
};
