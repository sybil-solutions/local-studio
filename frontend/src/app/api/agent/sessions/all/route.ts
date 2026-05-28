import { NextRequest } from "next/server";
import { existsSync, statSync } from "node:fs";
import { listProjectsFromStore } from "@/lib/agent/projects-store";
import { listSessions, type SessionSummary } from "@/lib/agent/sessions-store";
import { listArchivedSessionMetadata } from "@/lib/agent/session-metadata-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Aggregated session index across every registered project. The agent
// sidebar/dashboard loads this once and then filters/searches client-side so
// search-as-you-type stays snappy without per-keystroke fetches.
export type AggregatedSession = SessionSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};

function parseSince(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d+)([dhm])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return new Date(Date.now() - amount * multiplier);
}

function archiveOptions(searchParams: URLSearchParams): {
  includeArchived?: boolean;
  archivedOnly?: boolean;
} {
  const archived = searchParams.get("archived")?.toLowerCase();
  const includeArchived = searchParams.get("includeArchived")?.toLowerCase();
  return {
    ...(includeArchived === "1" || includeArchived === "true" ? { includeArchived: true } : {}),
    ...(archived === "1" || archived === "true" || archived === "only"
      ? { archivedOnly: true, includeArchived: true }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = parseSince(sinceParam) ?? undefined;
  const archive = archiveOptions(request.nextUrl.searchParams);
  const projects = listProjectsFromStore();
  const aggregated: AggregatedSession[] = [];
  const seenIds = new Set<string>();
  await Promise.all(
    projects.map(async (project) => {
      try {
        if (!existsSync(project.path) || !statSync(project.path).isDirectory()) return;
        const sessions = await listSessions(project.path, {
          ...(since && !archive.archivedOnly ? { since } : {}),
          ...archive,
        });
        for (const summary of sessions) {
          seenIds.add(summary.id);
          aggregated.push({
            ...summary,
            projectId: project.id,
            projectName: project.name,
            projectPath: project.path,
          });
        }
      } catch {
        // Skip a project that can't be read; we still want results from the rest.
      }
    }),
  );
  if (archive.archivedOnly) {
    for (const metadata of listArchivedSessionMetadata()) {
      if (seenIds.has(metadata.id)) continue;
      aggregated.push({
        id: metadata.id,
        filename: "",
        cwd: metadata.cwd ?? "",
        startedAt: metadata.sessionUpdatedAt ?? metadata.archivedAt ?? metadata.updatedAt ?? "",
        updatedAt: metadata.sessionUpdatedAt ?? metadata.updatedAt ?? metadata.archivedAt ?? "",
        modelId: null,
        provider: null,
        firstUserMessage: metadata.title,
        turnCount: 0,
        archived: true,
        archivedAt: metadata.archivedAt,
        projectId: metadata.projectId ?? "",
        projectName: metadata.projectName ?? "Unknown project",
        projectPath: metadata.cwd ?? "",
      });
    }
  }
  aggregated.sort(
    (a, b) =>
      new Date(b.startedAt || b.updatedAt).getTime() -
      new Date(a.startedAt || a.updatedAt).getTime(),
  );
  return Response.json({ sessions: aggregated });
}
