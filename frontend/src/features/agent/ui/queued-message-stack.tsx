"use client";

import { useState, type ReactNode } from "react";
import type { QueuedMessage } from "@/features/agent/messages";
import { CornerDownRight, Trash2 } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

type QueuedMessageStackProps = {
  items: QueuedMessage[];
  running: boolean;
  onEdit: (queueId: string, text: string) => void;
  onRemove: (queueId: string) => void;
  onSteer: (queueId: string) => void;
};

/** The pending follow-ups, stacked oldest-first inside the composer drawer.
 *
 * Every row is editable in place, can be promoted to a steer (delivered at the
 * next turn boundary instead of waiting), or dropped. Anything left here is
 * dispatched by pi only once the whole agent run would otherwise stop — never
 * between reasoning blocks or tool calls. */
export function QueuedMessageStack({
  items,
  running,
  onEdit,
  onRemove,
  onSteer,
}: QueuedMessageStackProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  if (items.length === 0) return null;

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };
  /** An emptied message is a removal — there is nothing to send. */
  const commitEdit = (queueId: string) => {
    const trimmed = editingText.trim();
    if (trimmed) onEdit(queueId, trimmed);
    else onRemove(queueId);
    cancelEdit();
  };

  return (
    <div className="flex flex-col gap-0.5" data-testid="queued-message-stack">
      {items.map((item) => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          running={running}
          editing={editingId === item.id}
          editingText={editingText}
          onEditingTextChange={setEditingText}
          onStartEditing={() => {
            setEditingId(item.id);
            setEditingText(item.text);
          }}
          onCommitEdit={() => commitEdit(item.id)}
          onCancelEdit={cancelEdit}
          onSteer={() => onSteer(item.id)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}

function QueuedMessageRow({
  item,
  running,
  editing,
  editingText,
  onEditingTextChange,
  onStartEditing,
  onCommitEdit,
  onCancelEdit,
  onSteer,
  onRemove,
}: {
  item: QueuedMessage;
  running: boolean;
  editing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onStartEditing: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onSteer: () => void;
  onRemove: () => void;
}) {
  const steering = item.mode === "steer";
  return (
    <div
      className="group flex min-w-0 items-center gap-2 rounded-[10px] px-2 py-1 hover:bg-(--fg)/[0.03]"
      title={steering ? `Steering: ${item.text}` : `Queued: ${item.text}`}
    >
      <CornerDownRight
        className={cx("h-3.5 w-3.5 shrink-0", steering ? "text-(--accent)" : "text-(--fg)/34")}
        aria-hidden
      />
      {editing ? (
        <input
          autoFocus
          value={editingText}
          onChange={(event) => onEditingTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit();
            }
          }}
          onBlur={onCommitEdit}
          className="min-w-0 flex-1 rounded-md bg-(--fg)/[0.05] px-1.5 py-0.5 text-(--fg) outline-none"
          aria-label="Edit queued message"
        />
      ) : (
        <button
          type="button"
          onClick={onStartEditing}
          className="min-w-0 flex-1 truncate text-left text-(--fg)/72 hover:text-(--fg)"
          title="Click to edit"
        >
          {item.text}
        </button>
      )}
      {running && !steering ? (
        <button
          type="button"
          onClick={onSteer}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-(--fg)/55 transition-colors hover:bg-(--fg)/[0.06] hover:text-(--fg)"
          aria-label="Steer — send now into the current turn"
          title="Steer — send now into the current turn"
        >
          <CornerDownRight className="h-3 w-3" aria-hidden />
          Steer
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-md p-1 text-(--fg)/40 transition-colors hover:bg-(--fg)/[0.06] hover:text-(--fg)"
        aria-label="Remove queued message"
        title="Remove from queue"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
