"use client";

import type { DashboardLayoutProps } from "./dashboard-types";
import { DashboardConnectionBanner } from "./dashboard-connection-banner";
import { ControlPanel } from "../control-panel/control-panel";
import { LaunchToast } from "../launch-toast";
import { ReadinessMatrix } from "../readiness-matrix/readiness-matrix";

export function DashboardLayout(props: DashboardLayoutProps) {
  return (
    <div className="min-h-full bg-background text-foreground">
      <DashboardConnectionBanner isConnected={props.isConnected} />
      <div className="mx-auto max-w-[118rem] overflow-x-hidden px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 2xl:px-10">
        <ControlPanel {...props} />
        <ReadinessMatrix
          recipes={props.recipes}
          currentRecipe={props.currentRecipe}
          currentProcess={props.currentProcess}
          lifecycleStatus={props.lifecycleStatus}
        />
      </div>
      <LaunchToast launching={props.launching} launchProgress={props.launchProgress} />
    </div>
  );
}
