"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { AppPage, Button, Checkbox, KeyValueRow, StatusPill, Tabs } from "@/ui";
import { useLogs } from "@/features/logs/use-logs";
import { useRealtimeStatusStore } from "@/hooks/realtime-status-store";
import { getStoredBackendUrl } from "@/lib/api/connection";

type Tab = "logs" | "docs";

export default function ServerPage() {
  const {
    filteredSessions,
    selectedSession,
    loadingContent,
    autoScroll,
    logRef,
    setAutoScroll,
    loadLogContent,
    renderLogs,
    handleSelectSession,
    hasLogContent,
  } = useLogs();
  const realtime = useRealtimeStatusStore();
  const [tab, setTab] = useState<Tab>("logs");
  const backendUrl = useMemo(
    () => (getStoredBackendUrl() || "http://127.0.0.1:8080").replace(/\/+$/, ""),
    [],
  );
  const docsUrl = "/api/proxy/api/docs";
  const docsSpecUrl = "/api/proxy/api/spec";
  const docsSrcDoc = useMemo(() => swaggerSrcDoc(docsSpecUrl), [docsSpecUrl]);

  const summary = realtime.runtimeSummary;
  const process = realtime.status?.process ?? null;
  const backends = summary
    ? ([
        ["vllm", summary.backends.vllm],
        ["sglang", summary.backends.sglang],
        ["llamacpp", summary.backends.llamacpp],
        summary.backends.mlx ? ["mlx", summary.backends.mlx] : null,
      ].filter(Boolean) as [string, { installed: boolean; version: string | null }][])
    : [];

  return (
    <AppPage className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-b border-(--border) px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--color-foreground-subtle)">
              Server
            </div>
            <h1 className="mt-1 text-[length:var(--fs-3xl)] font-semibold tracking-[-0.015em]">
              Controller
            </h1>
            <p className="mt-1 font-mono text-xs text-(--color-foreground-subtle)">{backendUrl}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={realtime.connected ? "good" : "danger"} variant="badge">
              {realtime.connected ? "controller online" : "controller offline"}
            </StatusPill>
            <StatusPill tone={realtime.status?.running ? "good" : "default"} variant="badge">
              {realtime.status?.running ? "inference serving" : "inference idle"}
            </StatusPill>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => (selectedSession ? loadLogContent(selectedSession) : undefined)}
              icon={<RefreshCw className={`h-3.5 w-3.5 ${loadingContent ? "animate-spin" : ""}`} />}
            >
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Status console — the actual server surface */}
        <aside className="min-h-0 overflow-y-auto border-b border-(--border) lg:border-b-0 lg:border-r">
          <StatusGroup title="Connection">
            <KeyValueRow label="URL" value={<span className="font-mono">{backendUrl}</span>} />
            <KeyValueRow label="Reachable" value={realtime.connected ? "yes" : "no"} />
            <KeyValueRow label="Inference port" value={realtime.status?.inference_port ?? "—"} />
            {realtime.lease?.holder ? (
              <KeyValueRow label="Lease" value={realtime.lease.holder} />
            ) : null}
          </StatusGroup>

          <StatusGroup title="Runtime">
            <KeyValueRow
              label="Platform"
              value={
                summary
                  ? `${summary.platform.kind} (${summary.platform.vendor ?? "—"})`
                  : (realtime.platformKind ?? "—")
              }
            />
            <KeyValueRow
              label="GPU monitoring"
              value={
                summary
                  ? `${summary.gpu_monitoring.available ? "available" : "unavailable"} · ${summary.gpu_monitoring.tool}`
                  : "—"
              }
            />
            <KeyValueRow label="GPUs detected" value={realtime.gpus.length || "—"} />
          </StatusGroup>

          <StatusGroup title="Backends">
            {backends.length > 0 ? (
              backends.map(([name, info]) => (
                <div
                  key={name}
                  className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]"
                >
                  <span className="font-mono text-(--color-foreground-subtle)">{name}</span>
                  {info.installed ? (
                    <span className="font-mono text-(--color-success)">
                      {info.version ?? "installed"}
                    </span>
                  ) : (
                    <span className="text-(--color-foreground-subtlest)">not installed</span>
                  )}
                </div>
              ))
            ) : (
              <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
                Detecting…
              </div>
            )}
          </StatusGroup>

          <StatusGroup title="Active process">
            {process ? (
              <>
                <KeyValueRow label="Backend" value={process.backend ?? "—"} />
                <KeyValueRow label="PID" value={process.pid ?? "—"} />
                <KeyValueRow
                  label="Model"
                  value={process.served_model_name ?? process.model_path ?? "—"}
                />
                <KeyValueRow label="Port" value={process.port ?? "—"} />
              </>
            ) : (
              <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
                No model loaded.
              </div>
            )}
          </StatusGroup>

          {realtime.services.length > 0 ? (
            <StatusGroup title="Services">
              {realtime.services.map((svc) => (
                <div
                  key={svc.id}
                  className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]"
                >
                  <span className="min-w-0 truncate text-(--color-foreground-subtle)">
                    {svc.id}
                  </span>
                  <span
                    className={`shrink-0 font-mono ${
                      svc.status === "ok" || svc.status === "healthy"
                        ? "text-(--color-success)"
                        : svc.status === "error" || svc.last_error
                          ? "text-(--color-destructive)"
                          : "text-(--color-foreground-subtle)"
                    }`}
                  >
                    {svc.status}
                  </span>
                </div>
              ))}
            </StatusGroup>
          ) : null}

          <div className="border-t border-(--border) px-4 py-3">
            <Tabs
              variant="pill"
              items={[
                { id: "logs", label: "Server Logs" },
                { id: "docs", label: "API Docs" },
              ]}
              activeTab={tab}
              onSelectTab={setTab}
            />
          </div>
          <div className="max-h-[34vh] overflow-y-auto px-2 pb-3">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  setTab("logs");
                  handleSelectSession(session.id);
                }}
                className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-[length:var(--fs-sm)] ${
                  selectedSession === session.id
                    ? "bg-(--color-surface) text-(--fg)"
                    : "text-(--color-foreground-subtle) hover:bg-(--color-surface-hover) hover:text-(--fg)"
                }`}
                title={session.id}
              >
                {session.recipe_name || session.model || session.id}
              </button>
            ))}
          </div>
        </aside>

        {/* Log / docs viewer — secondary panel */}
        <div className="min-h-0 p-4">
          {tab === "logs" ? (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--color-card-border) px-3">
                <div className="truncate font-mono text-xs text-(--color-foreground-subtle)">
                  {selectedSession ?? "select a log stream"}
                </div>
                <Checkbox
                  checked={autoScroll}
                  onChange={setAutoScroll}
                  label="auto-scroll"
                  className="items-center text-[length:var(--fs-sm)]"
                  labelClassName="text-[length:var(--fs-sm)] font-normal"
                />
              </div>
              <div
                ref={logRef}
                className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[length:var(--fs-sm)] leading-5 text-(--fg)"
              >
                {loadingContent ? (
                  <div className="text-(--color-foreground-subtle)">Loading logs…</div>
                ) : hasLogContent ? (
                  renderLogs()
                ) : (
                  <div className="text-(--color-foreground-subtle)">No log content selected.</div>
                )}
              </div>
            </section>
          ) : (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--color-card-border) px-3 text-xs">
                <span className="text-(--color-foreground-subtle)">OpenAPI reference</span>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-(--color-foreground-subtle) hover:text-(--fg)"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <iframe
                srcDoc={docsSrcDoc}
                title="Controller API docs"
                sandbox="allow-scripts allow-same-origin allow-popups"
                className="min-h-0 flex-1 bg-white"
              />
            </section>
          )}
        </div>
      </div>
    </AppPage>
  );
}

function StatusGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-(--border) px-4 py-3">
      <div className="mb-2 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.16em] text-(--color-foreground-subtlest)">
        {title}
      </div>
      <dl className="space-y-1 text-[length:var(--fs-sm)]">{children}</dl>
    </div>
  );
}

function swaggerSrcDoc(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>vLLM Studio API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui.css" />
    <style>
      html, body, #swagger-ui { margin: 0; min-height: 100%; background: #fff; }
      .swagger-ui .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          dom_id: "#swagger-ui",
          url: ${JSON.stringify(specUrl)}
        });
      };
    </script>
  </body>
</html>`;
}
