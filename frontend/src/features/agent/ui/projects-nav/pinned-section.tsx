"use client";

import { useState } from "react";
import { sessionActivity, useSessionActivity } from "@/features/agent/session-index";
import type { SessionPrefs } from "@/features/agent/messages/prefs";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import { mergeActiveSessionPref } from "./helpers";
import { SidebarRail, SidebarSectionHeader } from "./nav-chrome";
import { toggleProjectPin, type PinnedNav, type PinnedNavEntry } from "./pinned";
import { ActiveSessionRow, ProjectRow, SessionRow } from "./session-rows";
import type { ActiveAgentSession } from "./types";

/** Pinned projects and sessions, in one drag-orderable rail that matches the
 *  Tasks and Projects rails exactly — same indent, same guide line, same rows. */
export function PinnedSection({
  pinned,
  activeSessions,
  prefs,
  onRemoveProject,
}: {
  pinned: PinnedNav;
  activeSessions: readonly ActiveAgentSession[];
  prefs: SessionPrefs;
  onRemoveProject: (project: ProjectEntry) => void;
}) {
  const [open, setOpen] = useState(true);
  const [openProjectIds, setOpenProjectIds] = useState<ReadonlySet<string>>(new Set());
  const activity = useSessionActivity();

  if (pinned.entries.length === 0) return null;

  const toggleProject = (projectId: string) =>
    setOpenProjectIds((current) => {
      const next = new Set(current);
      if (!next.delete(projectId)) next.add(projectId);
      return next;
    });

  const renderEntry = (entry: PinnedNavEntry) => {
    const dragProps = pinned.entryDragProps(entry.id);
    if (entry.kind === "project") {
      return (
        <ProjectRow
          key={entry.id}
          project={entry.project}
          open={openProjectIds.has(entry.project.id)}
          onToggle={() => toggleProject(entry.project.id)}
          activeSessions={activeSessions.filter(
            (session) => session.projectId === entry.project.id,
          )}
          prefs={prefs}
          excludedIds={pinned.renderedSessionIds}
          pinned
          onTogglePin={() => toggleProjectPin(entry.project.id, false)}
          onRemove={() => onRemoveProject(entry.project)}
          reorderDraggable
          {...dragProps}
        />
      );
    }
    if (entry.kind === "active") {
      return (
        <ActiveSessionRow
          key={entry.id}
          project={entry.project}
          session={entry.session}
          pref={mergeActiveSessionPref(entry.session, prefs)}
          activity={sessionActivity(
            [entry.session.id, entry.session.threadId],
            activity,
            entry.session.status,
            entry.session.focused,
          )}
          {...dragProps}
        />
      );
    }
    return (
      <SessionRow
        key={entry.id}
        project={entry.project}
        session={entry.session}
        pref={prefs[entry.session.id] ?? {}}
        {...dragProps}
      />
    );
  };

  return (
    <div
      className={`flex flex-col gap-[var(--sidebar-row-gap)] rounded-[var(--sidebar-row-radius)] transition-[background-color,box-shadow] ${
        pinned.dragging ? "bg-(--surface-2)/40 ring-1 ring-inset ring-(--border)" : ""
      }`}
      {...pinned.listDropProps}
    >
      <SidebarSectionHeader label="Pinned" open={open} onToggle={() => setOpen((v) => !v)} />
      {open ? <SidebarRail>{pinned.entries.map(renderEntry)}</SidebarRail> : null}
    </div>
  );
}
