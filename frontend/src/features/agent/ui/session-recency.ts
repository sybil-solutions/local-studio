import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import type { AggregatedSession } from "@shared/agent/session-summary";

export function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  return `${Math.floor(delta / day)}d`;
}

function parseEpoch(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Recents is keyed on the newest user prompt, but a session whose transcript
 * tail carries no timestamped user turn still belongs in the list — fall back
 * to the file's own recency rather than dropping the row.
 */
export function recentsAt(session: AggregatedSession): number {
  const prompt = parseEpoch(session.lastUserPromptAt);
  return Number.isFinite(prompt) ? prompt : parseEpoch(session.updatedAt);
}

export function recentsTimestamp(session: AggregatedSession): string {
  return session.lastUserPromptAt ?? session.updatedAt;
}

export function orderByRecency(sessions: readonly AggregatedSession[]): AggregatedSession[] {
  return [...sessions].sort((a, b) => {
    const atA = recentsAt(a);
    const atB = recentsAt(b);
    if (atB !== atA) return (atB || 0) - (atA || 0);
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
