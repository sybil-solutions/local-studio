export type TerminalOwnerKind = "project" | "session";

export type TerminalOwner = {
  /** Stable PTY owner key. Electron reuses this key to reattach to a live PTY. */
  mountKey: string;
  /** Alternate identities that should resolve to this same terminal tab. */
  matchKeys: string[];
  /** cwd used when the PTY is first created. Existing PTYs keep their own cwd. */
  cwd: string | null;
  /** Human label for the right-sidebar terminal tab. */
  title: string;
  kind: TerminalOwnerKind;
  sessionId?: string | null;
  piSessionId?: string | null;
  projectId?: string | null;
};

export function uniqueTerminalKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

export function terminalKeysMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}

export function mergeTerminalKeys(a: readonly string[], b: readonly string[]): string[] {
  return uniqueTerminalKeys([...a, ...b]);
}

export function terminalOwnerLabel(owner: TerminalOwner, index: number): string {
  const title = owner.title.trim();
  if (title) return title;
  return owner.kind === "project" ? "Project terminal" : `Terminal ${index + 1}`;
}

export type TerminalFocus = {
  id: string;
  piSessionId?: string | null;
  projectId?: string | null;
};

export function isTerminalOwnerVisible(
  owner: TerminalOwner,
  focusedSession: TerminalFocus | null,
  activeProjectId: string | null,
): boolean {
  const projectId = focusedSession?.projectId ?? activeProjectId;
  if (focusedSession) {
    if (owner.piSessionId != null && owner.piSessionId === (focusedSession.piSessionId ?? null)) {
      return true;
    }
    if (owner.sessionId === focusedSession.id) return true;
    return owner.projectId == null || owner.projectId === projectId;
  }
  return owner.projectId == null || owner.projectId === projectId;
}
