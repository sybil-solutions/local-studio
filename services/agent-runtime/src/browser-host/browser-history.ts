// Computer-use history: an append-only ring of everything the embedded browser
// did, whoever drove it.
//
// Both the model (through the cua extension's `browser_history` tool) and the
// Browser panel read the same buffer, so "what has this computer been doing"
// has one answer. It lives in the runtime process rather than the extension
// because the extension is reloaded per session while the browser host is not,
// and because panel-driven navigation has to show up too — a model that only
// sees its own calls will confidently describe a page the user has since
// navigated away from.
//
// In memory only: this is a working log for the current runtime, not a
// browsing-history database, and persisting every URL a user visits to disk is
// not something a coding tool should do silently.

import { getGlobalSingleton } from "../instances";

export type BrowserHistoryEntry = {
  /** ISO timestamp. */
  at: string;
  /** Verb as issued: navigate, click, fill, scroll, back, get-text, … */
  action: string;
  /** Page URL at the time of the action, when known. */
  url?: string;
  title?: string;
  /** Short human summary of the arguments (selector, delta, …). */
  detail?: string;
  ok: boolean;
  error?: string;
};

const RING_SIZE = 250;

class BrowserHistory {
  private entries: BrowserHistoryEntry[] = [];
  private lastUrl = "";
  private lastTitle = "";

  record(entry: Omit<BrowserHistoryEntry, "at">): void {
    if (entry.url) this.lastUrl = entry.url;
    if (entry.title) this.lastTitle = entry.title;
    this.entries.push({
      at: new Date().toISOString(),
      ...entry,
      url: entry.url || this.lastUrl || undefined,
      title: entry.title || (entry.url ? undefined : this.lastTitle) || undefined,
    });
    if (this.entries.length > RING_SIZE) {
      this.entries = this.entries.slice(this.entries.length - RING_SIZE);
    }
  }

  /** Most recent `limit` entries, oldest first. */
  list(limit = 50): BrowserHistoryEntry[] {
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(RING_SIZE, Math.trunc(limit))) : 50;
    return this.entries.slice(-bounded);
  }

  /** Distinct pages in visit order — the "where has it been" view. */
  visitedUrls(limit = 50): Array<{ url: string; title?: string; at: string }> {
    const seen = new Map<string, { url: string; title?: string; at: string }>();
    for (const entry of this.entries) {
      if (!entry.url) continue;
      seen.set(entry.url, { url: entry.url, title: entry.title, at: entry.at });
    }
    return [...seen.values()].slice(-Math.max(1, limit));
  }

  clear(): void {
    this.entries = [];
  }
}

export const browserHistory = getGlobalSingleton("browserHistory", () => new BrowserHistory());
