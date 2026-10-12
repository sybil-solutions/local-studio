"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type AppUpdatePhase = "idle" | "working" | "ready" | "failed";
export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type AppUpdate = {
  currentVersion: string | null;
  releaseChannel: "dev" | "stable" | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  phase: AppUpdatePhase;
  status: AppUpdateStatus;
  progress: number | null;
  startUpdate: () => void;
};

function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = current.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

const bridge = () => window.localStudioDesktop ?? {};

function phaseForStatus(status: string): AppUpdatePhase {
  if (status === "downloaded") return "ready";
  if (status === "checking" || status === "available" || status === "downloading") return "working";
  if (status === "error") return "failed";
  return "idle";
}

function normalizedStatus(status: string): AppUpdateStatus {
  if (
    status === "checking" ||
    status === "available" ||
    status === "not-available" ||
    status === "downloading" ||
    status === "downloaded" ||
    status === "error"
  ) {
    return status;
  }
  return "idle";
}

function snapshotProgress(snapshot: { progress?: number; message?: string }): number | null {
  const parsed =
    typeof snapshot.progress === "number"
      ? snapshot.progress
      : Number.parseFloat(snapshot.message ?? "");
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, parsed));
}

export function useAppUpdate(): AppUpdate {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [releaseChannel, setReleaseChannel] = useState<"dev" | "stable" | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncDesktopPhase = useCallback(() => {
    const getStatus = bridge().getUpdateStatus;
    if (!getStatus) return;
    void getStatus().then(
      (snapshot) => {
        const nextStatus = normalizedStatus(snapshot.status);
        const next = phaseForStatus(nextStatus);
        setStatus(nextStatus);
        setPhase(next);
        setProgress(nextStatus === "downloading" ? snapshotProgress(snapshot) : null);
        if (snapshot.version) setLatestVersion(snapshot.version);
        if (next === "working") {
          if (pollTimer.current) clearTimeout(pollTimer.current);
          pollTimer.current = setTimeout(syncDesktopPhase, 2_000);
        }
      },
      () => {
        setStatus("error");
        setPhase("failed");
        setProgress(null);
      },
    );
  }, []);

  useMountSubscription(() => {
    let cancelled = false;
    void fetch("/api/app-update", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ latest?: string }>)
      .then((body) => {
        if (!cancelled) setLatestVersion(body.latest ?? null);
      })
      .catch(() => undefined);
    void bridge()
      .getRuntime?.()
      .then((runtime) => {
        if (!cancelled && runtime.packaged) {
          setCurrentVersion(runtime.appVersion);
          setReleaseChannel(runtime.releaseChannel);
        }
      })
      .catch(() => undefined);
    syncDesktopPhase();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [syncDesktopPhase]);

  const updateAvailable =
    releaseChannel === "stable" &&
    Boolean(latestVersion && currentVersion && isNewerVersion(latestVersion, currentVersion));

  const startUpdate = useCallback(() => {
    const desktop = bridge();
    if (!desktop.startUpdate) {
      setStatus("error");
      setPhase("failed");
      return;
    }
    setStatus("checking");
    setPhase("working");
    setProgress(null);
    void desktop.startUpdate().then(syncDesktopPhase, () => {
      setStatus("error");
      setPhase("failed");
      setProgress(null);
    });
  }, [syncDesktopPhase]);

  return {
    currentVersion,
    releaseChannel,
    latestVersion,
    updateAvailable,
    phase,
    status,
    progress,
    startUpdate,
  };
}
