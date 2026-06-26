import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { discoverMcpServers } from "@/features/agent/mcp/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readSkillMarkdown(dir: string, maxChars = 8000): string | undefined {
  const chunks: string[] = [];
  const visit = (current: string, depth: number) => {
    if (depth > 4 || chunks.join("\n\n").length >= maxChars) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    if (entries.includes("SKILL.md")) {
      const raw = readFileSync(path.join(current, "SKILL.md"), "utf8").trim();
      if (raw) chunks.push(raw);
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const candidate = path.join(current, entry);
      try {
        if (statSync(candidate).isDirectory()) visit(candidate, depth + 1);
      } catch {
        // ignore unreadable skill dirs
      }
    }
  };
  visit(dir, 0);
  const joined = chunks.join("\n\n---\n\n").slice(0, maxChars).trim();
  return joined || undefined;
}

export async function GET(request: NextRequest) {
  const queryPath = request.nextUrl.searchParams.get("path") ?? "";
  if (!queryPath) return NextResponse.json({ error: "path is required" }, { status: 400 });
  const resolved = path.resolve(queryPath);
  const server = discoverMcpServers().find(
    (row) => row.path && path.resolve(row.path) === resolved,
  );
  if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
  const instructions =
    server.skillPath && existsSync(server.skillPath)
      ? readSkillMarkdown(server.skillPath)
      : undefined;
  return NextResponse.json({ server: instructions ? { ...server, instructions } : server });
}
