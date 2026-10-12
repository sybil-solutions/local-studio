import type { LaunchProgress } from "@/lib/types";
import { ProgressBar } from "@/ui";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
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
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-4 right-4 z-50 px-3 py-2.5 sm:bottom-5 sm:left-auto sm:right-5 sm:w-[280px] ${POPOVER_SURFACE_CLASS}`}
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="space-y-1">
        <div className="text-[length:var(--fs-xs)] font-medium text-(--fg)">
          {renderStage(toast)}
        </div>
        <div className="truncate text-[length:var(--fs-xs)] text-(--dim)">{toast.message}</div>
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
