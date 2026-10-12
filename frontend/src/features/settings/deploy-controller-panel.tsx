"use client";

import { useState } from "react";
import { HardDrive, Rocket } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { SettingsButton, SettingsGroup } from "./settings-ui";
import type { SavedController } from "@/lib/api/controllers";
import { useControllerDeploy } from "./use-controller-deploy";

/**
 * Desktop-only: install a controller on this machine or onto an ssh-reachable
 * one, and hand the resulting url + api key back to the controllers list.
 * Renders nothing in the browser build.
 */
export function DeployControllerPanel({
  onDeployed,
}: {
  onDeployed: (controller: SavedController) => void;
}) {
  const deploy = useControllerDeploy();
  const [host, setHost] = useState("");

  if (!deploy.available) return null;

  const installLocal = async () => {
    const controller = await deploy.run({ mode: "local" }, "This machine");
    if (controller) onDeployed(controller);
  };

  const installRemote = async () => {
    const trimmed = host.trim();
    if (!trimmed) return;
    const controller = await deploy.run({ host: trimmed }, trimmed.split("@").pop() ?? trimmed);
    if (controller) onDeployed(controller);
  };

  return (
    <SettingsGroup
      title="Install a controller"
      description="On this machine (loopback), or on another one over ssh (key auth). It appears in your list when it's healthy."
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
        <SettingsButton onClick={installLocal} disabled={deploy.running}>
          {deploy.running ? <Spinner size="xs" /> : <HardDrive className="h-3 w-3" />}
          This machine
        </SettingsButton>
        <span className="text-[length:var(--fs-sm)] text-(--dim)">or</span>
        <input
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="user@hostname (ssh)"
          spellCheck={false}
          className="min-w-60 flex-1 border border-(--border) bg-transparent px-2 py-1 text-[length:var(--fs-md)] font-mono outline-none focus:border-(--accent)"
        />
        <SettingsButton onClick={installRemote} disabled={deploy.running || !host.trim()}>
          {deploy.running ? <Spinner size="xs" /> : <Rocket className="h-3 w-3" />}
          Deploy
        </SettingsButton>
      </div>
      {(deploy.lines.length > 0 || deploy.error || deploy.done) && (
        <div className="px-4 pb-3.5">
          {deploy.lines.length > 0 && (
            <pre className="max-h-48 overflow-y-auto border border-(--border) px-3 py-2 text-[11px] leading-5 text-(--dim) font-mono whitespace-pre-wrap">
              {deploy.lines.slice(-12).join("\n")}
            </pre>
          )}
          {deploy.error && (
            <div className="mt-2 text-[length:var(--fs-md)] text-(--err)">{deploy.error}</div>
          )}
          {deploy.done && (
            <div className="mt-2 text-[length:var(--fs-md)] text-(--ok)">{deploy.done}</div>
          )}
        </div>
      )}
    </SettingsGroup>
  );
}
