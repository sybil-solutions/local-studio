import { NextResponse } from "next/server";
import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { piResourceDiagnostics } from "@/lib/agent/pi-sdk-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const codexDir = path.join(homedir(), ".codex");
  const piDir = path.join(homedir(), ".pi");
  // Extension load failures captured during the most recent SDK runtime
  // creation. Surfaced here so users dropping a broken extension into
  // `<agentDir>/extensions/` see why it didn't activate.
  const diagnostics = piResourceDiagnostics();
  return NextResponse.json({
    checks: [
      {
        id: "pi-sdk",
        label: "Pi SDK",
        ok: typeof createAgentSessionRuntime === "function",
        value: "@earendil-works/pi-coding-agent",
        guidance: "The agent runtime is provided by the bundled Pi SDK package.",
      },
      {
        id: "pi-dir",
        label: "Pi data directory",
        ok: existsSync(piDir),
        value: piDir,
        guidance: "The directory is created after the first Pi run.",
      },
      {
        id: "codex-dir",
        label: "Codex config directory",
        ok: existsSync(codexDir),
        value: codexDir,
        guidance: "Optional but recommended for plugins and skills parity.",
      },
    ],
    diagnostics,
  });
}
