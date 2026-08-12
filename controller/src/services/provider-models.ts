import { Effect, Schema } from "effect";
import type { ProviderConfig } from "../config/persisted-config";
import { buildProviderApiUrl } from "./provider-routing";

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
});

export interface ProviderModelCatalog {
  provider: string;
  name: string;
  models: Array<{ id: string }>;
}

const fetchProviderModels = (
  provider: ProviderConfig,
): Effect.Effect<ProviderModelCatalog, unknown> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(buildProviderApiUrl(provider.base_url, "/models"), {
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
    return { provider: provider.id, name: provider.name, models };
  });

export const fetchConfiguredProviderModels = (
  providers: ProviderConfig[],
): Effect.Effect<ProviderModelCatalog[]> =>
  Effect.forEach(
    providers.filter((provider) => provider.enabled && provider.api_key),
    (provider) => fetchProviderModels(provider).pipe(Effect.option),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((results) =>
      results.flatMap((result) => (result._tag === "Some" ? [result.value] : [])),
    ),
  );
