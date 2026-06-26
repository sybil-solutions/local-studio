import { useCallback, useSyncExternalStore } from "react";
import {
  mergeTerminalKeys,
  terminalKeysMatch,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";

const TERMINAL_OWNERS_KEY = "local-studio.agent.terminals.v1";
const TERMINAL_ACTIVE_OWNER_KEY = "local-studio.agent.terminals.activeOwner";

export type TerminalOwnersSnapshot = {
  owners: TerminalOwner[];
  activeOwnerKey: string | null;
};

const terminalOwnerListeners = new Set<() => void>();
let terminalState: TerminalOwnersSnapshot = {
  owners: loadPersistedTerminalOwners(),
  activeOwnerKey: loadActiveOwnerKey(),
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitizeOwner(value: unknown): TerminalOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mountKey = typeof record.mountKey === "string" ? record.mountKey.trim() : "";
  const matchKeys = Array.isArray(record.matchKeys)
    ? record.matchKeys.filter((item): item is string => typeof item === "string" && Boolean(item))
    : [];
  if (!mountKey) return null;
  return {
    mountKey,
    matchKeys: mergeTerminalKeys([mountKey], matchKeys),
    cwd: typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : null,
    title: typeof record.title === "string" ? record.title.trim() : "Terminal",
    kind: record.kind === "project" ? "project" : "session",
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    piSessionId: typeof record.piSessionId === "string" ? record.piSessionId : null,
    projectId: typeof record.projectId === "string" ? record.projectId : null,
  };
}

function loadPersistedTerminalOwners(): TerminalOwner[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(TERMINAL_OWNERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const owners: TerminalOwner[] = [];
    for (const entry of parsed) {
      const owner = sanitizeOwner(entry);
      if (
        !owner ||
        owners.some((existing) => terminalKeysMatch(existing.matchKeys, owner.matchKeys))
      ) {
        continue;
      }
      owners.push(owner);
    }
    return owners;
  } catch {
    return [];
  }
}

function loadActiveOwnerKey(): string | null {
  const storage = safeStorage();
  if (!storage) return null;
  const key = storage.getItem(TERMINAL_ACTIVE_OWNER_KEY)?.trim();
  return key || null;
}

function persistTerminalState(state = terminalState): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(TERMINAL_OWNERS_KEY, JSON.stringify(state.owners));
    if (state.activeOwnerKey) storage.setItem(TERMINAL_ACTIVE_OWNER_KEY, state.activeOwnerKey);
    else storage.removeItem(TERMINAL_ACTIVE_OWNER_KEY);
  } catch {
    // Keep the in-memory state if storage is unavailable/quota-limited.
  }
}

function emitTerminalOwnersChanged(): void {
  for (const listener of terminalOwnerListeners) listener();
}

function setTerminalState(next: TerminalOwnersSnapshot): void {
  if (next === terminalState) return;
  terminalState = next;
  persistTerminalState(next);
  emitTerminalOwnersChanged();
}

function activeKeyFor(owners: TerminalOwner[], preferred: string | null): string | null {
  if (preferred && owners.some((owner) => owner.mountKey === preferred)) return preferred;
  return owners[0]?.mountKey ?? null;
}

function rememberTerminalOwner(owner: TerminalOwner, options: { select?: boolean } = {}): boolean {
  const ownerIndex = terminalState.owners.findIndex((terminal) =>
    terminalKeysMatch(terminal.matchKeys, owner.matchKeys),
  );
  const select = options.select === true;
  if (ownerIndex < 0) {
    const owners = [...terminalState.owners, owner];
    setTerminalState({
      owners,
      activeOwnerKey:
        select || !terminalState.activeOwnerKey ? owner.mountKey : terminalState.activeOwnerKey,
    });
    return true;
  }

  const current = terminalState.owners[ownerIndex];
  const matchKeys = mergeTerminalKeys(current.matchKeys, owner.matchKeys);
  const nextOwner: TerminalOwner = {
    ...current,
    ...owner,
    mountKey: current.mountKey,
    matchKeys,
    cwd: owner.cwd ?? current.cwd,
    title: owner.title || current.title,
  };
  const same =
    nextOwner.cwd === current.cwd &&
    nextOwner.title === current.title &&
    nextOwner.kind === current.kind &&
    nextOwner.sessionId === current.sessionId &&
    nextOwner.piSessionId === current.piSessionId &&
    nextOwner.projectId === current.projectId &&
    nextOwner.matchKeys.length === current.matchKeys.length;
  const activeOwnerKey = select ? current.mountKey : terminalState.activeOwnerKey;
  if (same && activeOwnerKey === terminalState.activeOwnerKey) return false;
  const owners = terminalState.owners.map((terminal, index) =>
    index === ownerIndex ? nextOwner : terminal,
  );
  setTerminalState({ owners, activeOwnerKey });
  return true;
}

export function rememberPersistentTerminalOwner(
  owner: TerminalOwner,
  options: { select?: boolean } = {},
): void {
  rememberTerminalOwner(owner, options);
}

export function selectPersistentTerminalOwner(ownerKey: string): void {
  const key = ownerKey.trim();
  if (!key || terminalState.activeOwnerKey === key) return;
  if (!terminalState.owners.some((owner) => owner.mountKey === key)) return;
  setTerminalState({ ...terminalState, activeOwnerKey: key });
}

export function removePersistentTerminalOwner(ownerKey: string): TerminalOwner | null {
  const key = ownerKey.trim();
  const removed = terminalState.owners.find((owner) => owner.mountKey === key) ?? null;
  if (!removed) return null;
  const owners = terminalState.owners.filter((owner) => owner.mountKey !== key);
  setTerminalState({ owners, activeOwnerKey: activeKeyFor(owners, terminalState.activeOwnerKey) });
  return removed;
}

export function clearPersistentTerminalOwners(): TerminalOwner[] {
  if (terminalState.owners.length === 0) return [];
  const removed = terminalState.owners;
  setTerminalState({ owners: [], activeOwnerKey: null });
  return removed;
}

function getTerminalOwnersSnapshot(): TerminalOwnersSnapshot {
  return terminalState;
}

function subscribeTerminalOwners(listener: () => void): () => void {
  terminalOwnerListeners.add(listener);
  return () => terminalOwnerListeners.delete(listener);
}

export function usePersistentTerminalOwners(
  active: boolean,
  owner: TerminalOwner | null,
): TerminalOwnersSnapshot {
  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribe = subscribeTerminalOwners(notify);
      if (active && owner) {
        const activeOwnerExists =
          terminalState.activeOwnerKey &&
          terminalState.owners.some(
            (terminal) => terminal.mountKey === terminalState.activeOwnerKey,
          );
        if (!activeOwnerExists) {
          queueMicrotask(() => rememberTerminalOwner(owner, { select: true }));
        }
      }
      return unsubscribe;
    },
    [active, owner],
  );

  return useSyncExternalStore(subscribe, getTerminalOwnersSnapshot, getTerminalOwnersSnapshot);
}
