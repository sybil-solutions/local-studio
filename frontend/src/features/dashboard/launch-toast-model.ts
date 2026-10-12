import type { LaunchProgress, LaunchStage } from "@/lib/types";

const HIDDEN_TERMINAL_STAGES = new Set<LaunchStage>([
  "preempting",
  "evicting",
  "launching",
  "waiting",
]);

const NON_PROGRESS_STAGES = new Set<LaunchStage>(["ready", "error", "cancelled"]);

export interface LaunchToastView {
  message: string;
  progressPercent: number | null;
  stageTone: "default" | "error" | "ready";
  stageText: string;
  visible: boolean;
}

export function resolveLaunchToastView(
  launching: boolean,
  launchProgress: LaunchProgress | null,
): LaunchToastView {
  const visible = shouldShowLaunchToast(launching, launchProgress);
  return {
    message: launchProgress?.message || "Preparing model launch...",
    progressPercent: progressPercent(launchProgress),
    stageTone: stageTone(launchProgress?.stage),
    stageText: launchProgress?.stage || "Starting...",
    visible,
  };
}

function shouldShowLaunchToast(launching: boolean, launchProgress: LaunchProgress | null): boolean {
  if (!launching && !launchProgress) {
    return false;
  }
  return (
    launching || (launchProgress !== null && !HIDDEN_TERMINAL_STAGES.has(launchProgress.stage))
  );
}

function progressPercent(launchProgress: LaunchProgress | null): number | null {
  if (launchProgress?.progress == null || NON_PROGRESS_STAGES.has(launchProgress.stage)) {
    return null;
  }
  return Math.round(launchProgress.progress * 100);
}

function stageTone(stage: LaunchStage | undefined): LaunchToastView["stageTone"] {
  if (stage === "error" || stage === "cancelled") {
    return "error";
  }
  if (stage === "ready") {
    return "ready";
  }
  return "default";
}
