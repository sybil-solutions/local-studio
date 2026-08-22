"use client";

import { useCallback, useState } from "react";
import { Effect, Schema } from "effect";
import { RefreshCw } from "@/ui/icon-registry";
import { Button, StatusPill } from "@/ui";
import {
  DataRow,
  HeadCell,
  LeadCell,
  TableFrame,
  TableNotice,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const ApiReferenceSchema = Schema.Struct({
  title: Schema.String,
  version: Schema.String,
  description: Schema.optional(Schema.String),
  operations: Schema.Array(
    Schema.Struct({ method: Schema.String, path: Schema.String, summary: Schema.String }),
  ),
});

type ApiReference = typeof ApiReferenceSchema.Type;

const loadApiReference = Effect.tryPromise({
  try: async () => {
    const response = await fetch("/api/proxy/api/spec", { cache: "no-store" });
    if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}`);
    return Schema.decodeUnknownSync(ApiReferenceSchema)(await response.json());
  },
  catch: (error) => (error instanceof Error ? error : new Error("API reference unavailable")),
});

function useApiReference() {
  const [spec, setSpec] = useState<ApiReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return Effect.runPromise(loadApiReference)
      .then(setSpec)
      .catch((reason: unknown) => {
        setSpec(null);
        setError(reason instanceof Error ? reason.message : "API reference unavailable");
      })
      .finally(() => setLoading(false));
  }, []);

  useMountSubscription(() => {
    void load();
  }, [load]);

  return { spec, loading, error, load };
}

export function OpenApiPanel() {
  const { spec, loading, error, load } = useApiReference();
  const operations = spec?.operations ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel)">
      <div className="mx-auto max-w-5xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-(--border) pb-5">
          <div>
            <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
              Controller reference
            </div>
            <h2 className="mt-1 text-[length:var(--fs-2xl)] font-semibold tracking-tight text-(--fg)">
              {spec?.title ?? (loading ? "Loading controller API…" : "Controller API")}
            </h2>
            {spec?.description ? (
              <p className="mt-2 max-w-2xl text-[length:var(--fs-sm)] leading-5 text-(--color-foreground-subtle)">
                {spec.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {spec ? <StatusPill tone="good">v{spec.version}</StatusPill> : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-(--color-destructive)/30 bg-(--color-destructive)/10 px-4 py-3 text-[length:var(--fs-sm)] text-(--color-destructive)">
            {error}
          </div>
        ) : null}

        {!error && operations.length === 0 && !loading ? (
          <TableNotice
            title="No operations to show"
            body="The controller answered without any documented paths. Refresh once it is up, or check that /api/spec is being served."
          />
        ) : null}

        {!error && operations.length > 0 ? (
          <div className="mt-3">
            <TableFrame minWidthClass="min-w-[40rem]">
              <thead>
                <tr>
                  <HeadCell>Method</HeadCell>
                  <HeadCell>Path</HeadCell>
                  <HeadCell>Summary</HeadCell>
                </tr>
              </thead>
              <tbody>
                {operations.map((operation) => (
                  <DataRow key={`${operation.method}:${operation.path}`}>
                    <LeadCell>
                      <span className="font-mono text-[length:var(--fs-xs)] font-semibold text-(--fg)">
                        {operation.method}
                      </span>
                    </LeadCell>
                    <TextCell mono>
                      <span className="text-(--link)">{operation.path}</span>
                    </TextCell>
                    <TextCell widthClass="max-w-[28rem]" title={operation.summary}>
                      {operation.summary}
                    </TextCell>
                  </DataRow>
                ))}
              </tbody>
            </TableFrame>
          </div>
        ) : null}
      </div>
    </div>
  );
}
