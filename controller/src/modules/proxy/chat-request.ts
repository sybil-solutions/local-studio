import type { Logger } from "../../core/logger";
import type { AppContext } from "../../app-context";
import { Effect } from "effect";
import type { Recipe } from "../models/types";
import { buildInferenceUrl } from "../../http/local-fetch";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveConfiguredProviderConfig,
  type ProviderRouteConfig,
} from "../../services/provider-routing";
const PROXY_SESSION_HEADER_NAMES = [
  "x-vllm-session-id",
  "x-session-id",
  "x-chat-session-id",
  "openai-conversation-id",
];

const NON_RUNNING_MODEL_WARN_INTERVAL_MS = 10 * 60_000;

interface NonRunningModelWarningState {
  lastWarnAt: number;
  suppressed: number;
}

export interface NonRunningModelWarnDetails {
  requestedModel: string | null;
  requestedRecipeId: string;
  activeModel: string | null;
  source: string | null;
}

export const createNonRunningModelWarner = (
  logger: Pick<Logger, "warn">,
): ((details: NonRunningModelWarnDetails) => void) => {
  const warnings = new Map<string, NonRunningModelWarningState>();
  return (details) => {
    const key = [
      details.requestedRecipeId,
      details.requestedModel ?? "",
      details.activeModel ?? "",
      details.source ?? "",
    ].join("\u0000");
    const now = Date.now();
    const state = warnings.get(key) ?? { lastWarnAt: 0, suppressed: 0 };
    if (now - state.lastWarnAt < NON_RUNNING_MODEL_WARN_INTERVAL_MS) {
      state.suppressed += 1;
      warnings.set(key, state);
      return;
    }

    const suppressed = state.suppressed;
    warnings.set(key, { lastWarnAt: now, suppressed: 0 });
    logger.warn("Rejected chat request for non-running model", {
      requested_model: details.requestedModel,
      requested_recipe_id: details.requestedRecipeId,
      active_model: details.activeModel,
      source: details.source,
      ...(suppressed > 0 ? { suppressed_requests: suppressed } : {}),
    });
  };
};

export const extractSessionId = (
  parsedBody: Record<string, unknown>,
  header: (name: string) => string | undefined,
): string | null => {
  const fromHeader = PROXY_SESSION_HEADER_NAMES.map((name) => header(name)).find(Boolean);
  if (fromHeader?.trim()) return fromHeader.trim();

  const direct = parsedBody["session_id"] ?? parsedBody["sessionId"] ?? parsedBody["chat_id"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const metadata = parsedBody["metadata"];
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    const fromMetadata = record["session_id"] ?? record["sessionId"] ?? record["chat_id"];
    if (typeof fromMetadata === "string" && fromMetadata.trim()) return fromMetadata.trim();
  }

  return null;
};

export const findRecipeByModel = (
  modelName: string,
  context: Pick<AppContext, "stores">,
): Effect.Effect<Recipe | null, unknown> =>
  context.stores.recipeStore.list().pipe(
    Effect.map((recipes) => {
      const lower = modelName.toLowerCase();
      return (
        recipes.find((recipe) => {
          const served = (recipe.served_model_name ?? "").toLowerCase();
          const name = (recipe.name ?? "").toLowerCase();
          return served === lower || recipe.id.toLowerCase() === lower || (name && name === lower);
        }) ?? null
      );
    }),
  );

export interface UpstreamResolution {
  upstreamUrl: string;
  auth: Record<string, string>;
  requestProvider: string;
  providerRouting: ProviderRouteConfig | null;
  rewroteModel: boolean;
}

/**
 * Resolve where a requested model's traffic goes and how it authenticates.
 * A "provider/model" id routes to that configured provider with its key, and
 * anything else reaches the local inference engine with INFERENCE_API_KEY
 * when one is set. When provider-routed, the request body's model field is
 * rewritten to the provider-local id.
 */
export const resolveUpstreamForModel = (
  requestedModel: string | null,
  parsed: Record<string, unknown>,
  path: string,
  context: AppContext,
  options: { includeXApiKey?: boolean } = {},
): UpstreamResolution => {
  const providerModel = requestedModel
    ? parseProviderModel(requestedModel)
    : { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
  const requestProvider = providerModel.provider;
  const providerRouting =
    requestProvider !== DEFAULT_CHAT_PROVIDER
      ? resolveConfiguredProviderConfig(requestProvider, context.config.providers)
      : null;
  if (providerRouting) {
    parsed["model"] = providerModel.modelId;
    return {
      upstreamUrl: `${providerRouting.baseUrl.replace(/\/+$/, "")}${path}`,
      auth: {
        Authorization: `Bearer ${providerRouting.apiKey}`,
        // The Anthropic dialect authenticates with x-api-key; sending both
        // lets one configured key reach either kind of upstream.
        ...(options.includeXApiKey ? { "x-api-key": providerRouting.apiKey } : {}),
      },
      requestProvider,
      providerRouting,
      rewroteModel: true,
    };
  }
  const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
  return {
    upstreamUrl: buildInferenceUrl(context, path),
    auth: inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {},
    requestProvider,
    providerRouting: null,
    rewroteModel: false,
  };
};

export const ensureStreamingUsageIncluded = (payload: Record<string, unknown>): boolean => {
  if (!Boolean(payload["stream"])) return false;
  const existingStreamOptions =
    payload["stream_options"] &&
    typeof payload["stream_options"] === "object" &&
    !Array.isArray(payload["stream_options"])
      ? (payload["stream_options"] as Record<string, unknown>)
      : {};
  if (existingStreamOptions["include_usage"] === true) return false;
  payload["stream_options"] = {
    ...existingStreamOptions,
    include_usage: true,
  };
  return true;
};
