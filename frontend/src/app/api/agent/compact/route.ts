import { NextRequest } from "next/server";
import {
  type ComposerExtensionOverride,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
  sanitizeComposerExtensionOverrides,
  sanitizeComposerPlugins,
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
  selectedContextInstructions,
} from "@/lib/agent/composer-context";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompactRequest = {
  sessionId?: string;
  modelId?: string;
  cwd?: string;
  piSessionId?: string | null;
  customInstructions?: string;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  canvasEnabled?: boolean;
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
  promptTemplates?: ComposerPromptTemplateRef[];
  extensionOverrides?: ComposerExtensionOverride[];
};

function compactInstructions(
  plugins: ComposerPluginRef[],
  skills: ComposerSkillRef[],
  custom?: string,
): string | undefined {
  const selected = selectedContextInstructions(plugins, skills);
  let extra = custom?.trim() || "";
  if (selected && extra) {
    if (selected.includes(extra)) extra = "";
    else if (extra.includes(selected)) extra = extra.replace(selected, "").trim();
  }
  const additional = extra ? `Additional compaction instructions:\n${extra}` : null;
  return [selected, additional].filter((value): value is string => Boolean(value)).join("\n\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompactRequest | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });

  const sessionId = body.sessionId?.trim() || "default";
  const modelId = body.modelId?.trim();
  const cwd = body.cwd?.trim() || undefined;
  const piSessionId = body.piSessionId?.trim() || null;
  if (!modelId) return Response.json({ error: "modelId is required" }, { status: 400 });

  try {
    const session = piRuntimeManager.getSession(sessionId);
    const plugins = sanitizeComposerPlugins(body.plugins);
    const skills = sanitizeComposerSkills(body.skills);
    const promptTemplates = sanitizeComposerPromptTemplates(body.promptTemplates);
    const extensionOverrides = sanitizeComposerExtensionOverrides(body.extensionOverrides);
    await session.ensureStarted(modelId, cwd, piSessionId, {
      browserToolEnabled: body.browserToolEnabled === true,
      browserSessionId:
        typeof body.browserSessionId === "string" ? body.browserSessionId.trim() : undefined,
      canvasEnabled: body.canvasEnabled === true,
      plugins,
      skills,
      promptTemplates,
      extensionOverrides,
    });
    const result = await session.compact(
      compactInstructions(plugins, skills, body.customInstructions),
    );
    return Response.json({ ok: true, result, status: session.status });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Compaction failed" },
      { status: 409 },
    );
  }
}
