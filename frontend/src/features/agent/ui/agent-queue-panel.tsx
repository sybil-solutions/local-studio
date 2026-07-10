"use client";

import { useState, type ReactNode } from "react";
import type { QueuedMessage } from "@/features/agent/messages";
import { ArrowUp } from "@/ui/icon-registry";
import { CloseIcon } from "@/ui/icons";
import { cx } from "@/ui/utils";

type AgentQueuePanelProps = {
  items: QueuedMessage[];
  expanded: boolean;
  running: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onEdit: (queueId: string, text: string) => void;
  onRemove: (queueId: string) => void;
  onSteer: (queueId: string) => void;
};

export function AgentQueuePanel({
  items,
  expanded,
  running,
  onExpandedChange,
  onEdit,
  onRemove,
  onSteer,
}: AgentQueuePanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const latest = items[items.length - 1] ?? null;
  const visibleItems = expanded ? items : latest ? [latest] : [];

  if (items.length === 0) return null;

  function cancelEdit() {
    setEditingId(null);
    setEditingText("");
  }
  function commitEdit(queueId: string) {
    const trimmed = editingText.trim();
    if (trimmed) onEdit(queueId, trimmed);
    else onRemove(queueId);
    cancelEdit();
  }

  return (
    <div className="mx-auto mb-1 w-full max-w-[var(--composer-w)] overflow-hidden rounded-lg bg-(--composer) px-4 py-2 text-[length:var(--fs-sm)] text-(--fg)">
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        className="flex w-full min-w-0 items-center gap-2 text-left"
        aria-expanded={expanded}
        title="Queued follow-ups and steers"
      >
        <span className="shrink-0 font-mono text-[length:var(--fs-xs)] uppercase tracking-wide text-(--dim)">
          queue {items.length}
        </span>
        <span className="min-w-0 flex-1 truncate">{latest?.text ?? "No queued message"}</span>
      </button>
      {expanded ? (
        <div className="mt-1 space-y-0.5">
          {visibleItems.map((item) => {
            const editing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="flex min-w-0 items-center gap-2 py-1"
                title={`${item.mode === "steer" ? "Steer" : "Queued follow-up"}: ${item.text}`}
              >
                <span
                  className={cx(
                    "shrink-0 font-mono text-[length:var(--fs-xs)] uppercase tracking-wide",
                    item.mode === "steer" ? "text-(--accent)" : "text-(--dim)",
                  )}
                >
                  {item.mode === "steer" ? "steer" : "queue"}
                </span>
                {editing ? (
                  <input
                    autoFocus
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitEdit(item.id);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={() => commitEdit(item.id)}
                    className="min-w-0 flex-1 rounded-sm bg-(--surface-2)/60 px-1.5 py-0.5 text-[length:var(--fs-sm)] text-(--fg) outline-none"
                    aria-label="Edit queued message"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingText(item.text);
                    }}
                    className="min-w-0 flex-1 truncate text-left hover:text-(--fg)"
                    title="Click to edit"
                  >
                    {item.text}
                  </button>
                )}
                <QueueIconButton
                  label="Send now (steer)"
                  title="Send now - interrupt the current turn"
                  disabled={!running}
                  onClick={() => onSteer(item.id)}
                >
                  <ArrowUp className="h-3 w-3 stroke-[2.25]" />
                </QueueIconButton>
                <QueueIconButton
                  label="Remove queued message"
                  title="Remove from queue"
                  hoverClassName="hover:text-(--fg)"
                  onClick={() => onRemove(item.id)}
                >
                  <CloseIcon className="h-3 w-3" />
                </QueueIconButton>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function QueueIconButton({
  label,
  title,
  disabled,
  hoverClassName = "hover:text-(--accent)",
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  hoverClassName?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 p-0.5 text-(--dim) ${hoverClassName} disabled:opacity-30`}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}
