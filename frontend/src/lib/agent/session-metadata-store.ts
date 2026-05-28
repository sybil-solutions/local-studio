import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

const SESSION_METADATA_FILENAME = "agent-session-metadata.json";

export type SessionArchiveState = {
  archived: boolean;
  archivedAt: string | null;
};

type StoredSessionMetadata = {
  archived?: boolean;
  archivedAt?: string | null;
  updatedAt?: string;
};

type SessionMetadataStore = {
  version: 1;
  sessions: Record<string, StoredSessionMetadata>;
};

function defaultStore(): SessionMetadataStore {
  return { version: 1, sessions: {} };
}

function storePath(): string {
  return path.join(resolveDataDir(), SESSION_METADATA_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStore(value: unknown): SessionMetadataStore {
  if (!isRecord(value) || !isRecord(value.sessions)) return defaultStore();
  const sessions: Record<string, StoredSessionMetadata> = {};
  for (const [id, metadata] of Object.entries(value.sessions)) {
    if (!id.trim() || !isRecord(metadata)) continue;
    sessions[id] = {
      archived: metadata.archived === true,
      archivedAt: typeof metadata.archivedAt === "string" ? metadata.archivedAt : null,
      updatedAt: typeof metadata.updatedAt === "string" ? metadata.updatedAt : undefined,
    };
  }
  return { version: 1, sessions };
}

function readStore(): SessionMetadataStore {
  try {
    const filepath = storePath();
    if (!existsSync(filepath)) return defaultStore();
    return normalizeStore(JSON.parse(readFileSync(filepath, "utf-8")) as unknown);
  } catch {
    return defaultStore();
  }
}

function writeStore(store: SessionMetadataStore): void {
  const filepath = storePath();
  mkdirSync(path.dirname(filepath), { recursive: true });
  const tempPath = `${filepath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  try {
    chmodSync(tempPath, 0o600);
  } catch {
    // best effort
  }
  renameSync(tempPath, filepath);
}

export function sessionArchiveState(sessionId: string): SessionArchiveState {
  const metadata = readStore().sessions[sessionId];
  return {
    archived: metadata?.archived === true,
    archivedAt: metadata?.archived === true ? (metadata.archivedAt ?? null) : null,
  };
}

export function setSessionArchived(
  sessionId: string,
  archived: boolean,
  now = new Date(),
): SessionArchiveState {
  const id = sessionId.trim();
  if (!id) return { archived: false, archivedAt: null };
  const store = readStore();
  const current = store.sessions[id] ?? {};
  const archivedAt = archived ? (current.archivedAt ?? now.toISOString()) : null;
  if (archived) {
    store.sessions[id] = {
      ...current,
      archived: true,
      archivedAt,
      updatedAt: now.toISOString(),
    };
  } else {
    const next = { ...current, archived: false, archivedAt: null, updatedAt: now.toISOString() };
    if (
      !current.updatedAt ||
      Object.keys(current).every(
        (key) => key === "archived" || key === "archivedAt" || key === "updatedAt",
      )
    ) {
      delete store.sessions[id];
    } else {
      store.sessions[id] = next;
    }
  }
  writeStore(store);
  return { archived, archivedAt };
}
