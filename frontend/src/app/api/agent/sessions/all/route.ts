import { NextRequest } from "next/server";
import { existsSync, statSync } from "node:fs";
import { listProjectsFromStore } from "@local-studio/agent-runtime/projects-store";
import { listSessions } from "@local-studio/agent-runtime/sessions-store";
import type { AggregatedSession } from "@shared/agent/session-summary";
import { listArchivedSessionMetadata } from "@local-studio/agent-runtime/session-metadata-store";
import { archiveQueryOptions, parseRelativeSince } from "../session-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sinceParam = request.nextUrl.searchParams.get("since");
  const since = parseRelativeSince(sinceParam) ?? undefined;
  const archive = archiveQueryOptions(request.nextUrl.searchParams);
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
