"use client";

import { useState } from "react";
import { TerminalPanel } from "./terminal-panel";

export type TerminalOwner = {
  mountKey: string;
  matchKeys: string[];
  cwd: string | null;
};

export function uniqueTerminalKeys(keys: string[]): string[] {
  return [...new Set(keys.filter(Boolean))];
}

function terminalKeysMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}

function mergeTerminalKeys(a: readonly string[], b: readonly string[]): string[] {
  return uniqueTerminalKeys([...a, ...b]);
}

// Keep terminal panels mounted per session once opened so each session keeps its
// own PTY and scrollback while the user navigates elsewhere.
export function PersistentTerminals({
  active,
  owner,
}: {
  active: boolean;
  owner: TerminalOwner | null;
}) {
  const [terminals, setTerminals] = useState<TerminalOwner[]>([]);
  const ownerIndex =
    active && owner
      ? terminals.findIndex((terminal) => terminalKeysMatch(terminal.matchKeys, owner.matchKeys))
      : -1;
  const nextTerminals =
    active && owner && ownerIndex < 0
      ? [...terminals, owner]
      : active && owner && ownerIndex >= 0
        ? terminals.map((terminal, index) => {
            if (index !== ownerIndex) return terminal;
            const matchKeys = mergeTerminalKeys(terminal.matchKeys, owner.matchKeys);
            return matchKeys.length === terminal.matchKeys.length
              ? terminal
              : { ...terminal, matchKeys };
          })
        : terminals;
  if (nextTerminals !== terminals) setTerminals(nextTerminals);
  if (!nextTerminals.length) return null;
  return (
    <>
      {nextTerminals.map((terminal) => {
        const visible = Boolean(
          active && owner && terminalKeysMatch(terminal.matchKeys, owner.matchKeys),
        );
        return (
          <div
            key={terminal.mountKey}
            className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <TerminalPanel cwd={terminal.cwd} />
          </div>
        );
      })}
    </>
  );
}
