import { NextRequest, NextResponse } from "next/server";
import {
  addProjectToStore,
  listProjectsFromStore,
  removeProjectFromStore,
  type ProjectEntry,
} from "@/lib/agent/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = listProjectsFromStore();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read projects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { path?: unknown };
  try {
    body = (await request.json()) as { path?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const directoryPath = typeof body.path === "string" ? body.path.trim() : "";
  if (!directoryPath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  try {
    const project: ProjectEntry = addProjectToStore(directoryPath);
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add project" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    removeProjectFromStore(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove project" },
      { status: 500 },
    );
  }
}
