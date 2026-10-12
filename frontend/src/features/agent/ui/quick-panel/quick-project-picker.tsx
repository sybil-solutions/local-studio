"use client";

import { useState, type MouseEvent, type PointerEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Folder } from "@/ui/icons";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";

type Props = {
  projects: ProjectsContextValue;
};

function stopToolbarEvent(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}

export function QuickProjectPicker({ projects }: Props) {
  const [open, setOpen] = useState(false);
  // The projects store seeds from localStorage synchronously, so the client
  // knows the project on its first render and the server does not. Naming it
  // during hydration mismatches, and React answers a mismatch by discarding
  // and re-rendering the subtree — here, the whole composer toolbar.
  const [hydrated, setHydrated] = useState(false);
  useMountSubscription(() => setHydrated(true), []);
  const active = hydrated ? (projects.selectedProject ?? projects.projects[0] ?? null) : null;

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setOpen(false);
      }}
      onPointerDown={stopToolbarEvent}
      onMouseDown={stopToolbarEvent}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "inline-flex !h-auto !min-h-0 !min-w-0 max-w-[140px] items-center gap-1 rounded-sm bg-transparent px-1 py-0.5 font-mono text-[length:var(--fs-xs)] text-(--dim) transition-colors hover:text-(--fg)",
          open && "text-(--fg)",
        )}
        title={active?.name ?? "Choose project"}
        aria-label={`Project: ${active?.name ?? "none"}`}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{active?.name ?? "Choose project"}</span>
      </button>
      {open ? (
        <div
          className={`absolute top-full left-0 z-[80] mt-1 max-h-[280px] w-[220px] overflow-y-auto p-1.5 ${POPOVER_SURFACE_CLASS}`}
        >
          {projects.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                projects.selectProject(project);
                setOpen(false);
              }}
              className={cx(
                "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                project.id === active?.id ? "bg-(--hover)/50" : "hover:bg-(--hover)",
              )}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  project.id === active?.id ? "bg-(--accent)" : "bg-(--dim)/35",
                )}
              />
              <span className="truncate text-(--fg)">{project.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
