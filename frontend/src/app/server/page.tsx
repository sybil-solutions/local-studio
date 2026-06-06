"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { AppPage, Button, Checkbox, KeyValueRow, StatusPill, Tabs } from "@/ui";
import { useLogs } from "@/app/logs/hooks/use-logs";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import { getStoredBackendUrl } from "@/lib/backend-url";

type Tab = "logs" | "docs";

export default function ServerPage() {
  const status = useSidebarStatus();
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
  const [tab, setTab] = useState<Tab>("logs");
  const backendUrl = useMemo(() => getStoredBackendUrl() || "http://127.0.0.1:8080", []).replace(
    /\/+$/,
    "",
  );
  const docsUrl = "/api/proxy/api/docs";
  const docsSpecUrl = "/api/proxy/api/spec";
  const docsSrcDoc = useMemo(() => swaggerSrcDoc(docsSpecUrl), [docsSpecUrl]);

  return (
    <AppPage className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-b border-(--border) px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--dim)">
              Server
            </div>
            <h1 className="mt-1 text-[length:var(--fs-3xl)] font-semibold tracking-[-0.015em]">
              Controller
            </h1>
            <p className="mt-1 text-xs text-(--dim)">{backendUrl}</p>
          </div>
          <div className="flex items-center gap-2">
            <HealthPill label="controller" ok={status.online} />
            <HealthPill label="inference" ok={status.inferenceOnline} />
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

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-(--border) p-3 lg:border-b-0 lg:border-r">
          <div className="mb-3 text-[length:var(--fs-xs)] uppercase tracking-[0.16em] text-(--dim)">
            Server Health
          </div>
          <dl className="space-y-2 text-xs">
            <KeyValueRow label="Controller" value={status.online ? "online" : "offline"} />
            <KeyValueRow label="Inference" value={status.activityLine} />
            <KeyValueRow label="Model" value={status.model ?? "none"} />
          </dl>
          <Tabs
            variant="pill"
            className="mt-5"
            items={[
              { id: "logs", label: "Server Logs" },
              { id: "docs", label: "API Docs" },
            ]}
            activeTab={tab}
            onSelectTab={setTab}
          />
          <div className="mt-3 max-h-[42vh] overflow-y-auto">
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
                    ? "bg-(--active) text-(--fg)"
                    : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                }`}
                title={session.id}
              >
                {session.recipe_name || session.model || session.id}
              </button>
            ))}
          </div>
        </aside>

        <div className="min-h-0 p-4">
          {tab === "logs" ? (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden border border-(--border) bg-(--surface)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--border) px-3">
                <div className="truncate font-mono text-xs text-(--dim)">
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
                  <div className="text-(--dim)">Loading logs…</div>
                ) : hasLogContent ? (
                  renderLogs()
                ) : (
                  <div className="text-(--dim)">No log content selected.</div>
                )}
              </div>
            </section>
          ) : (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden border border-(--border) bg-(--surface)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--border) px-3 text-xs">
                <span>OpenAPI reference</span>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-(--dim) hover:text-(--fg)"
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
      </section>
    </AppPage>
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

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <StatusPill tone={ok ? "good" : "danger"} variant="badge">
      {label}
    </StatusPill>
  );
}
