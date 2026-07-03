"use client";

import { useRef, useState } from "react";
import { Rocket } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { SettingsButton, SettingsGroup } from "./settings-ui";
import type { SavedController } from "@/lib/api/controllers";

interface ControllerDeployBridge {
  start(options: {
    host: string;
    port?: number;
  }): Promise<{ ok: boolean; url?: string; apiKey?: string; error?: string }>;
  onLog(listener: (line: string) => void): () => void;
}

const getDeployBridge = (): ControllerDeployBridge | null => {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { localStudioDesktop?: { controllerDeploy?: ControllerDeployBridge } })
      .localStudioDesktop?.controllerDeploy ?? null
  );
};

/**
 * Desktop-only: install a controller onto an ssh-reachable machine and hand
 * the resulting url + api key back to the controllers list. Renders nothing
 * in the browser build.
 */
export function DeployControllerPanel({
  onDeployed,
}: {
  onDeployed: (controller: SavedController) => void;
}) {
  const bridge = getDeployBridge();
  const [host, setHost] = useState("");
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  if (!bridge) return null;

  const deploy = async () => {
    const trimmed = host.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setError(null);
    setDone(null);
    setLines([]);
    unsubscribeRef.current?.();
    unsubscribeRef.current = bridge.onLog((line) =>
      setLines((current) => [...current.slice(-40), line]),
    );
    try {
      const result = await bridge.start({ host: trimmed });
      if (result.ok && result.url) {
        onDeployed({
          url: result.url,
          apiKey: result.apiKey,
          name: trimmed.split("@").pop() ?? trimmed,
        });
        setDone(`Controller running at ${result.url} — added to your list.`);
      } else {
        setError(result.error ?? "Deploy failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setRunning(false);
    }
  };

  return (
    <SettingsGroup
      title="Deploy a controller"
      description="Install and start a controller on another machine over ssh (key auth). It appears in your list when it's healthy."
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="user@hostname (ssh)"
          spellCheck={false}
          className="min-w-60 flex-1 border border-(--border) bg-transparent px-2 py-1 text-[length:var(--fs-md)] font-mono outline-none focus:border-(--accent)"
        />
        <SettingsButton onClick={deploy} disabled={running || !host.trim()}>
          {running ? <Spinner size="xs" /> : <Rocket className="h-3 w-3" />}
          {running ? "Deploying…" : "Deploy"}
        </SettingsButton>
      </div>
      {(lines.length > 0 || error || done) && (
        <div className="px-4 pb-3.5">
          {lines.length > 0 && (
            <pre className="max-h-48 overflow-y-auto border border-(--border) px-3 py-2 text-[11px] leading-5 text-(--dim) font-mono whitespace-pre-wrap">
              {lines.slice(-12).join("\n")}
            </pre>
          )}
          {error && <div className="mt-2 text-[length:var(--fs-md)] text-(--err)">{error}</div>}
          {done && <div className="mt-2 text-[length:var(--fs-md)] text-(--ok)">{done}</div>}
        </div>
      )}
    </SettingsGroup>
  );
}
