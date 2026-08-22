import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody, requiredTrimmed } from "../../core/validation";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { savePersistedConfig, type ProviderConfig } from "../../config/persisted-config";
import {
  discoverProviderModels,
  enabledProvidersWithApiKey,
} from "../../services/provider-routing";

type ProviderView = {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  has_api_key: boolean;
};

const ProviderCreateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  api_key: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

const ProviderUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  base_url: Schema.optional(Schema.String),
  api_key: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

class ProviderPersistenceError extends Schema.TaggedErrorClass<ProviderPersistenceError>()(
  "ProviderPersistenceError",
  { message: Schema.String, source: Schema.optional(Schema.Unknown) },
) {}

const serializeProvider = (provider: ProviderConfig): ProviderView => ({
  id: provider.id,
  name: provider.name,
  base_url: provider.base_url,
  enabled: provider.enabled,
  has_api_key: Boolean(provider.api_key),
});

const saveProviders = (
  context: { config: { data_dir: string; providers: ProviderConfig[] } },
  providers: ProviderConfig[],
): Effect.Effect<void, ProviderPersistenceError> =>
  Effect.try({
    try: () => {
      savePersistedConfig(context.config.data_dir, { providers });
      context.config.providers = providers;
    },
    catch: (source) =>
      new ProviderPersistenceError({ message: "Could not save providers", source }),
  });

export const registerStudioProviderRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    effectRoute(app.get, "/studio/providers", (ctx) =>
      Effect.sync(() => ctx.json({ providers: context.config.providers.map(serializeProvider) })),
    ),

    effectRoute(app.post, "/studio/providers", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, ProviderCreateSchema);
        const id = (yield* requiredTrimmed(body.id, "id")).toLowerCase();
        const name = yield* requiredTrimmed(body.name, "name");
        const baseUrl = yield* requiredTrimmed(body.base_url, "base_url");
        if (context.config.providers.some((provider) => provider.id === id)) {
          return yield* Effect.fail(badRequest(`Provider "${id}" already exists`));
        }
        const provider: ProviderConfig = {
          id,
          name,
          base_url: baseUrl,
          api_key: body.api_key?.trim() ?? "",
          enabled: body.enabled ?? true,
        };
        yield* saveProviders(context, [...context.config.providers, provider]);
        return ctx.json({ success: true, provider: serializeProvider(provider) });
      }),
    ),

    effectRoute(app.put, "/studio/providers/:id", (ctx) =>
      Effect.gen(function* () {
        const providerId = ctx.req.param("id") ?? "";
        const body = yield* decodeJsonBody(ctx, ProviderUpdateSchema);
        const index = context.config.providers.findIndex((provider) => provider.id === providerId);
        const current = index >= 0 ? context.config.providers[index] : undefined;
        if (!current) return yield* Effect.fail(notFound(`Provider "${providerId}" not found`));
        const name =
          body.name === undefined ? current.name : yield* requiredTrimmed(body.name, "name");
        const baseUrl =
          body.base_url === undefined
            ? current.base_url
            : yield* requiredTrimmed(body.base_url, "base_url");
        const updated: ProviderConfig = {
          id: providerId,
          name,
          base_url: baseUrl,
          api_key: body.api_key?.trim() ?? current.api_key,
          enabled: body.enabled ?? current.enabled,
        };
        const providers = [...context.config.providers];
        providers[index] = updated;
        yield* saveProviders(context, providers);
        return ctx.json({ success: true, provider: serializeProvider(updated) });
      }),
    ),

    effectRoute(app.delete, "/studio/providers/:id", (ctx) =>
      Effect.gen(function* () {
        const providerId = ctx.req.param("id") ?? "";
        if (!context.config.providers.some((provider) => provider.id === providerId)) {
          return yield* Effect.fail(notFound(`Provider "${providerId}" not found`));
        }
        yield* saveProviders(
          context,
          context.config.providers.filter((provider) => provider.id !== providerId),
        );
        return ctx.json({ success: true });
      }),
    ),

    effectRoute(app.get, "/studio/provider-models", (ctx) =>
      Effect.forEach(
        enabledProvidersWithApiKey(context.config.providers),
        (provider) => discoverProviderModels(provider).pipe(Effect.option),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((results) =>
          ctx.json({
            providers: results.flatMap((result) => (result._tag === "Some" ? [result.value] : [])),
          }),
        ),
      ),
    ),
  );
});
