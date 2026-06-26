"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw } from "@/ui/icon-registry";
import { AppPage, Button, Checkbox, KeyValueRow, StatusPill, Tabs } from "@/ui";
import { useLogs } from "@/features/logs/use-logs";
import { useRealtimeStatusStore, type RealtimeStatusSnapshot } from "@/hooks/realtime-status-store";
import { getStoredBackendUrl } from "@/lib/api/connection";

type Tab = "logs" | "docs";
type BackendInfo = { installed: boolean; version: string | null };

export default function ServerPage() {
  const logs = useLogs();
  const realtime = useRealtimeStatusStore();
  const [tab, setTab] = useState<Tab>("logs");
  const backendUrl = useMemo(
    () => (getStoredBackendUrl() || "http://127.0.0.1:8080").replace(/\/+$/, ""),
    [],
  );
  const docsSrcDoc = useMemo(() => swaggerSrcDoc("/api/proxy/api/spec"), []);

  return (
    <AppPage className="flex h-full min-h-0 flex-col overflow-hidden">
      <ServerHeader
        backendUrl={backendUrl}
        connected={realtime.connected}
        running={Boolean(realtime.status?.running)}
        loadingContent={logs.loadingContent}
        selectedSession={logs.selectedSession}
        onRefresh={() =>
          logs.selectedSession ? logs.loadLogContent(logs.selectedSession) : undefined
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
        <ServerStatusAside
          realtime={realtime}
          backendUrl={backendUrl}
          tab={tab}
          setTab={setTab}
          sessions={logs.filteredSessions}
          selectedSession={logs.selectedSession}
          onSelectSession={logs.handleSelectSession}
        />
        <ServerViewerPanel
          tab={tab}
          selectedSession={logs.selectedSession}
          loadingContent={logs.loadingContent}
          autoScroll={logs.autoScroll}
          setAutoScroll={logs.setAutoScroll}
          logRef={logs.logRef}
          hasLogContent={logs.hasLogContent}
          renderLogs={logs.renderLogs}
          docsSrcDoc={docsSrcDoc}
        />
      </div>
    </AppPage>
  );
}

function ServerHeader({
  backendUrl,
  connected,
  running,
  loadingContent,
  selectedSession,
  onRefresh,
}: {
  backendUrl: string;
  connected: boolean;
  running: boolean;
  loadingContent: boolean;
  selectedSession: string | null;
  onRefresh: () => void;
}) {
  return (
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
          <StatusPill tone={connected ? "good" : "danger"} variant="badge">
            {connected ? "controller online" : "controller offline"}
          </StatusPill>
          <StatusPill tone={running ? "good" : "default"} variant="badge">
            {running ? "inference serving" : "inference idle"}
          </StatusPill>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={!selectedSession}
            icon={<RefreshCw className={`h-3.5 w-3.5 ${loadingContent ? "animate-spin" : ""}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>
    </header>
  );
}

function ServerStatusAside({
  realtime,
  backendUrl,
  tab,
  setTab,
  sessions,
  selectedSession,
  onSelectSession,
}: {
  realtime: RealtimeStatusSnapshot;
  backendUrl: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  sessions: ReturnType<typeof useLogs>["filteredSessions"];
  selectedSession: string | null;
  onSelectSession: (id: string) => void;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-b border-(--border) lg:border-b-0 lg:border-r">
      <ConnectionGroup realtime={realtime} backendUrl={backendUrl} />
      <RuntimeGroup realtime={realtime} />
      <BackendsGroup realtime={realtime} />
      <ProcessGroup realtime={realtime} />
      <ServicesGroup realtime={realtime} />
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
      <SessionList
        sessions={sessions}
        selectedSession={selectedSession}
        onSelect={onSelectSession}
        onActivate={() => setTab("logs")}
      />
    </aside>
  );
}

function ConnectionGroup({
  realtime,
  backendUrl,
}: {
  realtime: RealtimeStatusSnapshot;
  backendUrl: string;
}) {
  return (
    <StatusGroup title="Connection">
      <KeyValueRow label="URL" value={<span className="font-mono">{backendUrl}</span>} />
      <KeyValueRow label="Reachable" value={realtime.connected ? "yes" : "no"} />
      <KeyValueRow label="Inference port" value={realtime.status?.inference_port ?? "—"} />
      {realtime.lease?.holder ? <KeyValueRow label="Lease" value={realtime.lease.holder} /> : null}
    </StatusGroup>
  );
}

function RuntimeGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  const summary = realtime.runtimeSummary;
  return (
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
  );
}

function BackendsGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  const backends = deriveBackends(realtime.runtimeSummary);
  return (
    <StatusGroup title="Backends">
      {backends.length > 0 ? (
        backends.map(([name, info]) => <BackendRow key={name} name={name} info={info} />)
      ) : (
        <div className="text-[length:var(--fs-sm)] text-(--color-foreground-subtlest)">
          Detecting…
        </div>
      )}
    </StatusGroup>
  );
}

function ProcessGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  const process = realtime.status?.process ?? null;
  return (
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
  );
}

function ServicesGroup({ realtime }: { realtime: RealtimeStatusSnapshot }) {
  if (realtime.services.length === 0) return null;
  return (
    <StatusGroup title="Services">
      {realtime.services.map((svc) => (
        <div
          key={svc.id}
          className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]"
        >
          <span className="min-w-0 truncate text-(--color-foreground-subtle)">{svc.id}</span>
          <span className={`shrink-0 font-mono ${serviceToneClass(svc.status, svc.last_error)}`}>
            {svc.status}
          </span>
        </div>
      ))}
    </StatusGroup>
  );
}

function BackendRow({ name, info }: { name: string; info: BackendInfo }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[length:var(--fs-sm)]">
      <span className="font-mono text-(--color-foreground-subtle)">{name}</span>
      {info.installed ? (
        <span className="font-mono text-(--color-success)">{info.version ?? "installed"}</span>
      ) : (
        <span className="text-(--color-foreground-subtlest)">not installed</span>
      )}
    </div>
  );
}

function SessionList({
  sessions,
  selectedSession,
  onSelect,
  onActivate,
}: {
  sessions: ReturnType<typeof useLogs>["filteredSessions"];
  selectedSession: string | null;
  onSelect: (id: string) => void;
  onActivate: () => void;
}) {
  return (
    <div className="max-h-[34vh] overflow-y-auto px-2 pb-3">
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          onClick={() => {
            onActivate();
            onSelect(session.id);
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
  );
}

function ServerViewerPanel(props: {
  tab: Tab;
  selectedSession: string | null;
  loadingContent: boolean;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
  docsSrcDoc: string;
}) {
  if (props.tab === "logs") return <LogsPanel {...props} />;
  return <DocsPanel docsSrcDoc={props.docsSrcDoc} />;
}

function LogsPanel({
  selectedSession,
  loadingContent,
  autoScroll,
  setAutoScroll,
  logRef,
  hasLogContent,
  renderLogs,
}: {
  selectedSession: string | null;
  loadingContent: boolean;
  autoScroll: boolean;
  setAutoScroll: (v: boolean) => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
  docsSrcDoc: string;
}) {
  return (
    <div className="min-h-0 p-4">
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
          <LogContent
            loadingContent={loadingContent}
            hasLogContent={hasLogContent}
            renderLogs={renderLogs}
          />
        </div>
      </section>
    </div>
  );
}

function LogContent({
  loadingContent,
  hasLogContent,
  renderLogs,
}: {
  loadingContent: boolean;
  hasLogContent: boolean;
  renderLogs: () => ReactNode;
}) {
  if (loadingContent) return <div className="text-(--color-foreground-subtle)">Loading logs…</div>;
  if (hasLogContent) return <>{renderLogs()}</>;
  return <div className="text-(--color-foreground-subtle)">No log content selected.</div>;
}

function DocsPanel({ docsSrcDoc }: { docsSrcDoc: string }) {
  return (
    <div className="min-h-0 p-4">
      <section className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-lg border border-(--color-card-border) bg-(--color-card)">
        <div className="flex min-h-10 items-center justify-between border-b border-(--color-card-border) px-3 text-xs">
          <span className="text-(--color-foreground-subtle)">OpenAPI reference</span>
          <a
            href="/api/proxy/api/docs"
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
    </div>
  );
}

function StatusGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--border) px-4 py-3">
      <div className="mb-2 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.16em] text-(--color-foreground-subtlest)">
        {title}
      </div>
      <dl className="space-y-1 text-[length:var(--fs-sm)]">{children}</dl>
    </div>
  );
}

// --- Pure helpers (keep JSX complexity low) ---

function deriveBackends(
  summary: RealtimeStatusSnapshot["runtimeSummary"],
): [string, BackendInfo][] {
  if (!summary) return [];
  const entries: ([string, BackendInfo] | null)[] = [
    ["vllm", summary.backends.vllm],
    ["sglang", summary.backends.sglang],
    ["llamacpp", summary.backends.llamacpp],
    summary.backends.mlx ? ["mlx", summary.backends.mlx] : null,
  ];
  return entries.filter((e): e is [string, BackendInfo] => e !== null);
}

function serviceToneClass(status: string, lastError?: string | null): string {
  if (status === "ok" || status === "healthy") return "text-(--color-success)";
  if (status === "error" || lastError) return "text-(--color-destructive)";
  return "text-(--color-foreground-subtle)";
}

function swaggerSrcDoc(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Studio API Docs</title>
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
