"use client";

import type { ReactNode } from "react";
import type { SessionActivity } from "@/features/agent/session-index";
import { Spinner } from "@/ui";
import { PinIcon } from "@/ui/icon-registry";
import { ChevronDownIcon } from "@/ui/icons";

/** The trailing status mark every session row shows: spinner while running,
 *  green dot when a run finished, accent dot for unseen activity. Layout
 *  differs per host — the project tree reserves a w-8 spinner column and lets
 *  its flex-1 label push the dots right, the recents list right-aligns each
 *  mark itself — so the wrapper classes come from the caller. */
export function SessionStatusMark({
  activity,
  runningClass,
  dotClass,
}: {
  activity: SessionActivity;
  runningClass: string;
  dotClass: string;
}) {
  if (activity === "running") {
    return (
      <span className={runningClass} aria-label="Session running">
        <Spinner size="xs" className="text-(--link)" />
      </span>
    );
  }
  if (activity === "finished") {
    return (
      <span className={`${dotClass} bg-(--ok)`} aria-label="Run finished" title="Run finished" />
    );
  }
  if (activity === "unseen") {
    return (
      <span
        className={`${dotClass} bg-(--link)`}
        aria-label="Unseen activity"
        title="Unseen activity"
      />
    );
  }
  return null;
}

/** The one pin control for every sidebar row (sessions and projects). It sits in
 *  the row's hover action cluster and, once pinned, stays lit as the pinned
 *  indicator. */
export function PinButton({
  pinned,
  onToggle,
  target,
}: {
  pinned: boolean;
  onToggle: () => void;
  target: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      aria-label={pinned ? `Unpin ${target}` : `Pin ${target}`}
      title={pinned ? "Unpin" : "Pin"}
      // Hidden at rest even when pinned — living in the Pinned section already
      // says so, and an always-on glyph collided with the date column. On hover
      // it slides in from the left over the trailing text with a fade.
      className={`inline-flex h-5 w-5 items-center justify-center rounded-[var(--rad-xs)] transition-[opacity,transform,color] duration-150 hover:text-(--fg) ${
        pinned ? "text-(--fg)/75" : "text-(--dim)/70"
      } ${"-translate-x-1.5 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 focus-visible:translate-x-0 focus-visible:opacity-100 pointer-coarse:translate-x-0 pointer-coarse:opacity-100"}`}
    >
      <PinIcon className="pointer-events-none h-3 w-3" />
    </button>
  );
}

/** Flat column that session rows live in - no guide line, no indent, so rows
 *  start at the same x-column as the section header text. */
export function SidebarRail({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

export function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
  indicator = false,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  indicator?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      className="group flex cursor-default items-center justify-between pe-0.5 ps-2 pb-0.5 pt-1.5 text-[length:var(--fs-xs)] font-normal text-(--hl2)"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--dim) focus-visible:text-(--dim) focus-visible:outline-none"
        aria-expanded={open}
      >
        <span>{label}</span>
        {!open && indicator ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--link)"
            aria-label={`${label} has unseen activity`}
            title={`${label} has unseen activity`}
          />
        ) : null}
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {action ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </div>
      ) : null}
    </div>
  );
}
