import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { getApiSettings } from "@local-studio/agent-runtime/settings-service";
import { requireApiAccess } from "@/lib/auth/guard";
import { createApiCore, type ApiCore } from "@/lib/api/core";
import type { RecipeWithStatus } from "@/lib/types";
import {
  inferVisionSupport,
  normalizeOpenAIModels,
  type OpenAIModelsResponse,
} from "@/features/agent/models";
import {
  attachModelToAgents,
  detectLocalAgents,
  LOCAL_AGENT_IDS,
  type LocalAgentId,
} from "@/features/settings/local-agents";
import { errorMessage, jsonError } from "../_lib/route-helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const agents = await detectLocalAgents(os.homedir());
    return NextResponse.json({ agents });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to detect local agents"), 500);
  }
}

const isLocalAgentId = (value: unknown): value is LocalAgentId =>
  typeof value === "string" && (LOCAL_AGENT_IDS as readonly string[]).includes(value);

async function resolveModelImages(core: ApiCore, recipe: RecipeWithStatus, modelId: string) {
  try {
    const payload = await core.request<OpenAIModelsResponse>("/v1/models", {
      timeout: 10_000,
      retries: 0,
    });
    const model = normalizeOpenAIModels(payload).find((entry) => entry.id === modelId);
    if (model) return model.vision;
  } catch {
    // Some controller targets may expose recipes before /v1/models is reachable.
    // Fall back to the same stable name/path inference used by the agent model picker.
  }

  return inferVisionSupport(`${modelId} ${recipe.name} ${recipe.model_path}`);
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const { modelId, targets } = (body ?? {}) as { modelId?: unknown; targets?: unknown };
  if (typeof modelId !== "string" || !modelId.trim()) {
    return jsonError("modelId is required");
  }
  if (!Array.isArray(targets) || targets.length === 0 || !targets.every(isLocalAgentId)) {
    return jsonError(
      "targets must be a non-empty array of agent ids (pi, opencode, droid, hermes, omp)",
    );
  }

  const settings = await getApiSettings();
  const backendUrl = settings.backendUrl.replace(/\/+$/, "");
  const core = createApiCore({
    baseUrl: backendUrl,
    useProxy: false,
    apiKeyOverride: settings.apiKey,
  });

  let recipes: RecipeWithStatus[];
  try {
    const data = await core.request<RecipeWithStatus[]>("/recipes", {
      timeout: 10_000,
      retries: 0,
      headers: settings.apiKey ? { "X-API-Key": settings.apiKey } : undefined,
    });
    recipes = Array.isArray(data) ? data : [];
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to fetch recipes from controller"), 502);
  }

  // `||` (not `??`) so an empty served_model_name falls back to the recipe id,
  // matching how the UI derives the model id it sends here.
  const recipe = recipes.find((entry) => (entry.served_model_name || entry.id) === modelId);
  if (!recipe) return jsonError(`Model not found: ${modelId}`, 404);

  const contextWindow = recipe.max_model_len || 131072;
  const images = await resolveModelImages(core, recipe, modelId);
  try {
    const results = await attachModelToAgents({
      home: os.homedir(),
      targets,
      model: {
        modelId,
        displayName: recipe.name || modelId,
        baseUrl: `${backendUrl}/v1`,
        apiKey: settings.apiKey,
        contextWindow,
        maxTokens: contextWindow,
        reasoning: true,
        images,
      },
    });
    return NextResponse.json({ results });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to attach model to local agents"), 500);
  }
}
