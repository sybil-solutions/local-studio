"use client";

import { Download, RefreshCw } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { SettingsButton, SettingsGroup, SettingsRow, SettingsValue } from "./settings-ui";
import { useAppUpdate } from "@/features/shell/use-app-update";

export function AppVersionSection() {
  const update = useAppUpdate();
  const devChannel = update.releaseChannel === "dev";
  const progress = update.progress === null ? null : Math.round(update.progress);
  const onLatest = update.currentVersion && update.latestVersion && !update.updateAvailable;
  const description = devChannel
    ? "Dev builds update through the local installer."
    : update.updateAvailable
      ? update.phase === "ready"
        ? `v${update.latestVersion} is downloaded — restart to finish updating.`
        : update.status === "downloading"
          ? `Downloading v${update.latestVersion}${progress === null ? "." : ` — ${progress}%.`}`
          : `v${update.latestVersion} is available on GitHub.`
      : onLatest
        ? "You are on the latest version."
        : update.latestVersion
          ? `Latest release: v${update.latestVersion}.`
          : "Release check unavailable.";
  return (
    <SettingsGroup title="Application" description="Version and updates.">
      <SettingsRow
        label="Version"
        description={description}
        value={
          <SettingsValue mono>
            {update.currentVersion ? `v${update.currentVersion}` : "Web UI"}
          </SettingsValue>
        }
        actions={
          update.updateAvailable ? (
            <SettingsButton onClick={update.startUpdate} tone="primary">
              {update.status === "checking" ? (
                <Spinner size="xs" />
              ) : update.phase === "ready" ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {update.status === "checking"
                ? "Checking…"
                : update.status === "downloading"
                  ? progress === null
                    ? "Downloading…"
                    : `Downloading ${progress}%`
                  : update.phase === "ready"
                    ? "Restart to update"
                    : "Update"}
            </SettingsButton>
          ) : undefined
        }
      />
    </SettingsGroup>
  );
}
