"use client";

import { type ComponentType } from "react";
import type { ActiveSession } from "@/features/agent/session-contracts";

export type ProjectsNavSectionComponent = ComponentType<{ expanded: boolean }>;

export type SessionsCommandComponent = ComponentType<{
  open: boolean;
  onClose: () => void;
  activeSessions: readonly ActiveSession[];
}>;

let projectsNavSectionPromise: Promise<ProjectsNavSectionComponent> | null = null;
let sessionsCommandPromise: Promise<SessionsCommandComponent> | null = null;

export function loadProjectsNavSection(): Promise<ProjectsNavSectionComponent> {
  projectsNavSectionPromise ??= import("@/features/agent/ui/projects-nav-section").then(
    (mod) => mod.ProjectsNavSection,
  );
  return projectsNavSectionPromise;
}

export function loadSessionsCommand(): Promise<SessionsCommandComponent> {
  sessionsCommandPromise ??= import("@/features/agent/ui/sessions-command").then(
    (mod) => mod.SessionsCommand,
  );
  return sessionsCommandPromise;
}
