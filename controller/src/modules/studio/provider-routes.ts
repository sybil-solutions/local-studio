import { Effect, Schema } from "effect";
import { badRequest, notFound } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import type { RouteRegistrar } from "../../http/route-registrar";
import { savePersistedConfig, type ProviderConfig } from "../../config/persisted-config";

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

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
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

const required = (
  value: string,
  label: string,
): Effect.Effect<string, ReturnType<typeof badRequest>> => {
  const trimmed = value.trim();
  return trimmed ? Effect.succeed(trimmed) : Effect.fail(badRequest(`${label} is required`));
};

const providerModels = (
  provider: ProviderConfig,
): Effect.Effect<{ provider: string; models: Array<{ id: string }> }, unknown> =>
  Effect.gen(function* () {
    const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${provider.api_key}` },
          signal: AbortSignal.timeout(10_000),
        }),
      catch: (source) => source,
    });
    if (!response.ok) return yield* Effect.fail(response.status);
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (source) => source,
    });
    const decoded = yield* Schema.decodeUnknownEffect(ProviderModelsSchema)(payload);
    const models = (decoded.data ?? []).flatMap((model) => {
      const id = model.id?.trim();
      return id ? [{ id }] : [];
    });
    return { provider: provider.id, models };
  });

export const registerStudioProviderRoutes: RouteRegistrar = (app, context) => {
  app.get(
    "/studio/providers",
    effectHandler((ctx) =>
      Effect.sync(() => ctx.json({ providers: context.config.providers.map(serializeProvider) })),
    ),
  );

  app.post(
    "/studio/providers",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(ctx, ProviderCreateSchema);
        const id = (yield* required(body.id, "id")).toLowerCase();
        const name = yield* required(body.name, "name");
        const baseUrl = yield* required(body.base_url, "base_url");
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
  );

  app.put(
    "/studio/providers/:id",
    effectHandler((ctx) =>
      Effect.gen(function* () {
        const providerId = ctx.req.param("id") ?? "";
        const body = yield* decodeJsonBody(ctx, ProviderUpdateSchema);
        const index = context.config.providers.findIndex((provider) => provider.id === providerId);
        const current = index >= 0 ? context.config.providers[index] : undefined;
        if (!current) return yield* Effect.fail(notFound(`Provider "${providerId}" not found`));
        const name = body.name === undefined ? current.name : yield* required(body.name, "name");
        const baseUrl =
          body.base_url === undefined
            ? current.base_url
            : yield* required(body.base_url, "base_url");
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
  );

  app.delete(
    "/studio/providers/:id",
    effectHandler((ctx) =>
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
  );

  app.get(
    "/studio/provider-models",
    effectHandler((ctx) =>
      Effect.forEach(
        context.config.providers.filter((provider) => provider.enabled && provider.api_key),
        (provider) => providerModels(provider).pipe(Effect.option),
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
};
