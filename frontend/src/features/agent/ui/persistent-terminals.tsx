"use client";

import { useState } from "react";
import { type TerminalOwner } from "@/features/agent/terminal-owners";
import { TerminalPanel } from "@/features/agent/ui/terminal-panel";

// Each mounted TerminalPanel is a full xterm instance (renderer + scrollback
// buffer) plus a PTY attachment, so the set of kept-alive terminals is a
// bounded MRU rather than every terminal ever opened. Evicted terminals
// reattach to their still-running shell through the ownerKey PTY path when
// reactivated; only their rendered scrollback is dropped.
const MAX_MOUNTED_TERMINALS = 4;

export function PersistentTerminals({
  active,
  activeOwnerKey,
  terminals,
}: {
  active: boolean;
  activeOwnerKey: string | null;
  terminals: TerminalOwner[];
}) {
  const [openedKeys, setOpenedKeys] = useState<readonly string[]>([]);
  if (active && activeOwnerKey && openedKeys[openedKeys.length - 1] !== activeOwnerKey) {
    const reordered = [...openedKeys.filter((key) => key !== activeOwnerKey), activeOwnerKey];
    setOpenedKeys(reordered.slice(-MAX_MOUNTED_TERMINALS));
  }
  const mountedKeys = new Set(openedKeys);
  const opened = terminals.filter((terminal) => mountedKeys.has(terminal.mountKey));
  if (!opened.length) return null;
  return (
    <>
      {opened.map((terminal) => {
        const visible = Boolean(active && activeOwnerKey === terminal.mountKey);
        return (
          <div
            key={terminal.mountKey}
            className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          >
            <TerminalPanel cwd={terminal.cwd} ownerKey={terminal.mountKey} />
          </div>
        );
      })}
    </>
  );
}
