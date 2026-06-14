import type { LaunchProgress } from "@/lib/types";
import { ProgressBar } from "@/ui";
import { resolveLaunchToastView, type LaunchToastView } from "./launch-toast-model";

interface LaunchToastProps {
  launching: boolean;
  launchProgress: LaunchProgress | null;
}

export function LaunchToast({ launching, launchProgress }: LaunchToastProps) {
  const toast = resolveLaunchToastView(launching, launchProgress);
  if (!toast.visible) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 px-4 py-3 bg-(--surface) border border-(--border)/50 rounded sm:max-w-xs"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-(--fg) capitalize">{renderStage(toast)}</div>
        <div className="text-xs text-(--dim)">{toast.message}</div>
      </div>
      {toast.progressPercent != null && <ProgressBar progress={toast.progressPercent} />}
    </div>
  );
}

function renderStage(toast: LaunchToastView) {
  if (toast.stageTone === "error") {
    return <span className="text-(--err)">{toast.stageText}</span>;
  }
  if (toast.stageTone === "ready") {
    return <span className="text-(--hl2)">{toast.stageText}</span>;
  }
  return toast.stageText;
}
