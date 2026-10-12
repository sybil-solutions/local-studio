"use client";

import { useCallback, useState } from "react";
import { Button, UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type {
  AttachResult,
  LocalAgentId,
  LocalAgentTarget,
} from "@/features/settings/local-agents";

type Props = {
  modelId: string;
  modelName: string;
  onClose: () => void;
};

const LOGO_COLORS: Record<LocalAgentId, { background: string; foreground: string }> = {
  pi: { background: "#e8b931", foreground: "#171717" },
  opencode: { background: "#374151", foreground: "#f9fafb" },
  droid: { background: "#4f46e5", foreground: "#eef2ff" },
  hermes: { background: "#b45309", foreground: "#fffbeb" },
  omp: { background: "#0f766e", foreground: "#f0fdfa" },
};

function LocalAgentLogo({ agent }: { agent: LocalAgentId }) {
  const colors = LOGO_COLORS[agent];
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm"
      style={{ background: colors.background, color: colors.foreground }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      >
        {agent === "pi" ? (
          <path d="M5 6h14M8.5 6v12M15.5 6v12" strokeLinecap="round" />
        ) : agent === "opencode" ? (
          <>
            <path d="m9 7-5 5 5 5M15 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m14 5-4 14" strokeLinecap="round" />
          </>
        ) : agent === "droid" ? (
          <>
            <path d="M5 10.5A3.5 3.5 0 0 1 8.5 7h7a3.5 3.5 0 0 1 3.5 3.5v5A3.5 3.5 0 0 1 15.5 19h-7A3.5 3.5 0 0 1 5 15.5v-5Z" />
            <path d="M12 7V4M10 14h.01M14 14h.01" strokeLinecap="round" />
          </>
        ) : agent === "hermes" ? (
          <>
            <path
              d="M6 17c4.6-1.2 7.4-4.4 9-10 1.8 3.3 2.6 6.7 2.4 10.2-3.7.3-7.5.2-11.4-.2Z"
              strokeLinejoin="round"
            />
            <path d="M8 15.5 15.5 9M9.5 17l6.5-1.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="9" cy="12" r="4.5" />
            <circle cx="15" cy="12" r="4.5" />
          </>
        )}
      </svg>
    </span>
  );
}

export function AttachLocalAgentsDialog({ modelId, modelName, onClose }: Props) {
  const [agents, setAgents] = useState<LocalAgentTarget[] | null>(null);
  const [selected, setSelected] = useState<Set<LocalAgentId>>(new Set());
  const [attaching, setAttaching] = useState(false);
  const [results, setResults] = useState<AttachResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useMountSubscription(() => {
    void fetch("/api/local-agents", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ agents?: LocalAgentTarget[] }>)
      .then((payload) => {
        const detected = payload.agents ?? [];
        setAgents(detected);
        setSelected(new Set(detected.map((agent) => agent.agent)));
      })
      .catch(() => setAgents([]));
  }, []);

  const toggleAgent = useCallback((agent: LocalAgentId, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(agent);
      else next.delete(agent);
      return next;
    });
  }, []);

  const handleAttach = useCallback(async () => {
    setAttaching(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch("/api/local-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, targets: [...selected] }),
      });
      const payload = (await response.json()) as { results?: AttachResult[]; error?: string };
      if (!response.ok || !payload.results) {
        setError(payload.error || `Attach failed (HTTP ${response.status})`);
        return;
      }
      setResults(payload.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attach failed");
    } finally {
      setAttaching(false);
    }
  }, [modelId, selected]);

  return (
    <UiModal isOpen onClose={onClose} maxWidth="max-w-xl">
      <UiModalHeader title="Attach to local agents" onClose={onClose} />
      <UiModalBody>
        <p className="mb-4 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
          Write <span className="font-mono">{modelName}</span> as a provider/model entry into the
          config files of coding agents installed on this machine.
        </p>

        {agents === null ? (
          <p className="text-sm text-(--ui-muted)">Detecting local agents…</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-(--ui-muted)">
            No local agents detected (looked for pi, opencode, droid, Hermes, and omp config
            directories).
          </p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <label
                key={agent.agent}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-(--ui-border) bg-(--ui-bg) p-3 transition-colors hover:bg-(--ui-hover)"
              >
                <input
                  type="checkbox"
                  checked={selected.has(agent.agent)}
                  onChange={(event) => toggleAgent(agent.agent, event.target.checked)}
                  className="h-4 w-4 rounded border-(--ui-border) bg-(--ui-bg)"
                />
                <LocalAgentLogo agent={agent.agent} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-(--ui-fg)">{agent.label}</span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-(--ui-muted)">
                    {agent.configPath}
                    {agent.exists ? "" : " (will be created)"} — writes on this machine
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {error ? <p className="mt-4 text-sm text-(--ui-danger)">{error}</p> : null}

        {results ? (
          <div className="mt-4 space-y-2 border-t border-(--ui-border) pt-4">
            {results.map((result) => (
              <div key={result.agent} className="text-xs">
                <span
                  className={`font-semibold ${result.ok ? "text-(--ui-fg)" : "text-(--ui-danger)"}`}
                >
                  {result.agent}: {result.ok ? result.action : "failed"}
                </span>
                <span className="ml-2 font-mono text-(--ui-muted)">{result.configPath}</span>
                {result.ok && result.backupPath ? (
                  <div className="mt-0.5 font-mono text-(--ui-muted)">
                    backup: {result.backupPath}
                  </div>
                ) : null}
                {result.ok
                  ? result.extraUpdates?.map((update) => (
                      <div key={update.configPath} className="mt-0.5 font-mono text-(--ui-muted)">
                        also updated: {update.configPath}
                        {update.backupPath ? ` (backup: ${update.backupPath})` : ""}
                      </div>
                    ))
                  : null}
                {!result.ok && result.error ? (
                  <div className="mt-0.5 text-(--ui-danger)">{result.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </UiModalBody>
      <UiModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          onClick={() => void handleAttach()}
          loading={attaching}
          disabled={agents === null || selected.size === 0}
        >
          Attach
        </Button>
      </UiModalFooter>
    </UiModal>
  );
}
