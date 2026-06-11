"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Button, Checkbox, UiModal, UiModalHeader } from "@/ui";
import { getSettingsViewSnapshot } from "./settings-view-snapshot";
import type { AttachResult, LocalAgentId, LocalAgentTarget } from "./local-agents";

type Props = {
  modelId: string;
  modelName: string;
  onClose: () => void;
};

export function AttachLocalAgentsDialog({ modelId, modelName, onClose }: Props) {
  const [agents, setAgents] = useState<LocalAgentTarget[] | null>(null);
  const [selected, setSelected] = useState<Set<LocalAgentId>>(new Set());
  const [attaching, setAttaching] = useState(false);
  const [results, setResults] = useState<AttachResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subscribeAgents = useCallback((_notify: () => void) => {
    void fetch("/api/local-agents", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ agents?: LocalAgentTarget[] }>)
      .then((payload) => {
        const detected = payload.agents ?? [];
        setAgents(detected);
        setSelected(new Set(detected.map((agent) => agent.agent)));
      })
      .catch(() => setAgents([]));
    return () => {};
  }, []);
  useSyncExternalStore(subscribeAgents, getSettingsViewSnapshot, getSettingsViewSnapshot);

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
      <div className="p-6">
        <p className="mb-4 text-sm text-(--ui-muted)">
          Write <span className="font-mono">{modelName}</span> as a provider/model entry into the
          config files of coding agents installed on this machine.
        </p>

        {agents === null ? (
          <p className="text-sm text-(--ui-muted)">Detecting local agents…</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-(--ui-muted)">
            No local agents detected (looked for pi, opencode, and droid config directories).
          </p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <Checkbox
                key={agent.agent}
                checked={selected.has(agent.agent)}
                onChange={(checked) => toggleAgent(agent.agent, checked)}
                label={agent.label}
                description={`${agent.configPath}${agent.exists ? "" : " (will be created)"} — writes on this machine`}
              />
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
                {!result.ok && result.error ? (
                  <div className="mt-0.5 text-(--ui-danger)">{result.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => void handleAttach()}
            loading={attaching}
            disabled={agents === null || selected.size === 0}
          >
            Attach
          </Button>
        </div>
      </div>
    </UiModal>
  );
}
