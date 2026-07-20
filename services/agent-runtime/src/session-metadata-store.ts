import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { resolveDataDir } from "./data-dir";
import { isRecord } from "../../../shared/agent/guards";

const SESSION_METADATA_FILENAME = "agent-session-metadata.json";
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 80;

export type SessionArchiveState = {
  archived: boolean;
  archivedAt: string | null;
};

type StoredSessionMetadata = {
  archived?: boolean;
  archivedAt?: string | null;
  updatedAt?: string;
  cwd?: string;
  title?: string | null;
  projectId?: string;
  projectName?: string;
  sessionUpdatedAt?: string;
};

type SessionMetadataStore = {
  version: 1;
  sessions: Record<string, StoredSessionMetadata>;
};

export type ArchivedSessionMetadata = SessionArchiveState & {
  id: string;
  updatedAt: string | null;
  cwd: string | null;
  title: string | null;
  projectId: string | null;
  projectName: string | null;
  sessionUpdatedAt: string | null;
};

type SessionArchiveMetadataInput = {
  cwd?: string | null;
  title?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  sessionUpdatedAt?: string | null;
};

function defaultStore(): SessionMetadataStore {
  return { version: 1, sessions: {} };
}

function storePath(): string {
  return path.join(resolveDataDir(), SESSION_METADATA_FILENAME);
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
      cwd: typeof metadata.cwd === "string" ? metadata.cwd : undefined,
      title: typeof metadata.title === "string" ? metadata.title : null,
      projectId: typeof metadata.projectId === "string" ? metadata.projectId : undefined,
      projectName: typeof metadata.projectName === "string" ? metadata.projectName : undefined,
      sessionUpdatedAt:
        typeof metadata.sessionUpdatedAt === "string" ? metadata.sessionUpdatedAt : undefined,
    };
  }
  return { version: 1, sessions };
}

function backupUnreadableStore(filepath: string): void {
  if (!existsSync(filepath)) return;
  const backupPath = `${filepath}.corrupt-${Date.now()}.bak`;
  try {
    renameSync(filepath, backupPath);
    console.warn(`[agent-session-metadata] Moved unreadable metadata store to ${backupPath}`);
  } catch (error) {
    console.warn("[agent-session-metadata] Failed to preserve unreadable metadata store", error);
  }
}

function readStore(): SessionMetadataStore {
  const filepath = storePath();
  try {
    if (!existsSync(filepath)) return defaultStore();
    return normalizeStore(JSON.parse(readFileSync(filepath, "utf-8")) as unknown);
  } catch (error) {
    backupUnreadableStore(filepath);
    console.warn("[agent-session-metadata] Failed to read metadata store", error);
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
  } catch {}
  renameSync(tempPath, filepath);
}

async function withStoreLock<T>(callback: () => T): Promise<T> {
  const filepath = storePath();
  mkdirSync(path.dirname(filepath), { recursive: true });
  const release = await lockfile.lock(filepath, {
    realpath: false,
    stale: LOCK_STALE_MS,
    retries: {
      retries: LOCK_ATTEMPTS - 1,
      factor: 1,
      minTimeout: LOCK_RETRY_MS,
      maxTimeout: LOCK_RETRY_MS,
      randomize: false,
    },
  });
  try {
    return callback();
  } finally {
    await release();
  }
}

function cleanOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function applyMetadataInput(
  current: StoredSessionMetadata,
  metadata?: SessionArchiveMetadataInput,
): StoredSessionMetadata {
  if (!metadata) return current;
  const next = { ...current };
  const cwd = cleanOptionalString(metadata.cwd);
  const title = cleanOptionalString(metadata.title);
  const projectId = cleanOptionalString(metadata.projectId);
  const projectName = cleanOptionalString(metadata.projectName);
  const sessionUpdatedAt = cleanOptionalString(metadata.sessionUpdatedAt);
  if (cwd) next.cwd = cwd;
  if (title) next.title = title;
  if (projectId) next.projectId = projectId;
  if (projectName) next.projectName = projectName;
  if (sessionUpdatedAt) next.sessionUpdatedAt = sessionUpdatedAt;
  return next;
}

export function sessionArchiveState(sessionId: string): SessionArchiveState {
  const metadata = readStore().sessions[sessionId];
  return {
    archived: metadata?.archived === true,
    archivedAt: metadata?.archived === true ? (metadata.archivedAt ?? null) : null,
  };
}

export function listArchivedSessionMetadata(): ArchivedSessionMetadata[] {
  return Object.entries(readStore().sessions)
    .filter(([, metadata]) => metadata.archived === true)
    .map(([id, metadata]) => ({
      id,
      archived: true,
      archivedAt: metadata.archivedAt ?? null,
      updatedAt: metadata.updatedAt ?? null,
      cwd: metadata.cwd ?? null,
      title: metadata.title ?? null,
      projectId: metadata.projectId ?? null,
      projectName: metadata.projectName ?? null,
      sessionUpdatedAt: metadata.sessionUpdatedAt ?? null,
    }))
    .sort((a, b) => {
      const aTime = Date.parse(a.archivedAt ?? a.updatedAt ?? a.sessionUpdatedAt ?? "");
      const bTime = Date.parse(b.archivedAt ?? b.updatedAt ?? b.sessionUpdatedAt ?? "");
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
}

export async function setSessionArchived(
  sessionId: string,
  archived: boolean,
  now = new Date(),
  metadata?: SessionArchiveMetadataInput,
): Promise<SessionArchiveState> {
  const id = sessionId.trim();
  if (!id) return { archived: false, archivedAt: null };
  return withStoreLock(() => {
    const store = readStore();
    const current = store.sessions[id] ?? {};
    const archivedAt = archived ? (current.archivedAt ?? now.toISOString()) : null;
    if (archived) {
      store.sessions[id] = applyMetadataInput(
        {
          ...current,
          archived: true,
          archivedAt,
          updatedAt: now.toISOString(),
        },
        metadata,
      );
    } else {
      delete store.sessions[id];
    }
    writeStore(store);
    return { archived, archivedAt };
  });
}
