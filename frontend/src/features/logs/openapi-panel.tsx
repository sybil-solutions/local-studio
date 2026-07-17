"use client";

import { useCallback, useMemo, useState } from "react";
import { Effect, Schema } from "effect";
import { RefreshCw } from "@/ui/icon-registry";
import { Button, StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const OpenApiSpecSchema = Schema.Struct({
  openapi: Schema.String,
  info: Schema.Struct({
    title: Schema.String,
    version: Schema.String,
    description: Schema.optional(Schema.String),
  }),
  paths: Schema.Record(Schema.String, Schema.Unknown),
});

type OpenApiSpec = typeof OpenApiSpecSchema.Type;

type OpenApiOperation = {
  method: string;
  path: string;
  summary: string;
  description: string | null;
};

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function operationText(value: unknown, key: "summary" | "description"): string | null {
  const record = asRecord(value);
  return record && typeof record[key] === "string" ? record[key] : null;
}

function operationsFromSpec(spec: OpenApiSpec | null): OpenApiOperation[] {
  if (!spec) return [];
  return Object.entries(spec.paths).flatMap(([path, pathValue]) => {
    const pathRecord = asRecord(pathValue);
    if (!pathRecord) return [];
    return Object.entries(pathRecord).flatMap(([method, operation]) => {
      if (!HTTP_METHODS.has(method.toLowerCase())) return [];
      return [
        {
          method: method.toUpperCase(),
          path,
          summary: operationText(operation, "summary") ?? `${method.toUpperCase()} ${path}`,
          description: operationText(operation, "description"),
        },
      ];
    });
  });
}

const loadOpenApiSpec = Effect.tryPromise({
  try: async () => {
    const response = await fetch("/api/proxy/api/spec", { cache: "no-store" });
    if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}`);
    return Schema.decodeUnknownSync(OpenApiSpecSchema)(await response.json());
  },
  catch: (error) => (error instanceof Error ? error : new Error("API reference unavailable")),
});

function useOpenApiSpec() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return Effect.runPromise(loadOpenApiSpec)
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
  const { spec, loading, error, load } = useOpenApiSpec();
  const operations = useMemo(() => operationsFromSpec(spec), [spec]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel)">
      <div className="mx-auto max-w-5xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-(--border) pb-5">
          <div>
            <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--color-foreground-subtlest)">
              OpenAPI {spec?.openapi ?? "reference"}
            </div>
            <h2 className="mt-1 text-[length:var(--fs-2xl)] font-semibold tracking-tight text-(--fg)">
              {spec?.info.title ?? (loading ? "Loading controller API…" : "Controller API")}
            </h2>
            {spec?.info.description ? (
              <p className="mt-2 max-w-2xl text-[length:var(--fs-sm)] leading-5 text-(--color-foreground-subtle)">
                {spec.info.description}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {spec ? <StatusPill tone="good">v{spec.info.version}</StatusPill> : null}
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

        {!error && operations.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-lg border border-(--color-card-border)">
            {operations.map((operation) => (
              <div
                key={`${operation.method}:${operation.path}`}
                className="grid gap-2 border-b border-(--color-card-border) bg-(--color-card) px-4 py-3 last:border-b-0 md:grid-cols-[5rem_minmax(0,1fr)]"
              >
                <span className="w-fit rounded border border-(--border) bg-(--surface) px-1.5 py-0.5 font-mono text-[length:var(--fs-xs)] font-semibold text-(--fg)">
                  {operation.method}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[length:var(--fs-sm)] text-(--link)">
                      {operation.path}
                    </span>
                    <span className="text-[length:var(--fs-sm)] font-medium text-(--fg)">
                      {operation.summary}
                    </span>
                  </div>
                  {operation.description ? (
                    <p className="mt-1 text-[length:var(--fs-xs)] leading-5 text-(--color-foreground-subtle)">
                      {operation.description}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
