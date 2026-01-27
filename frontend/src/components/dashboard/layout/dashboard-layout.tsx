"use client";

import type { DashboardLayoutProps } from "./dashboard-types";
import { DashboardConnectionBanner } from "./dashboard-connection-banner";
import { ControlPanel } from "../control-panel/control-panel";
import { LaunchToast } from "../launch-toast";

export function DashboardLayout(props: DashboardLayoutProps) {
  return (
    <div className="min-h-full bg-background text-foreground">
      <DashboardConnectionBanner
        isConnected={props.isConnected}
        reconnectAttempts={props.reconnectAttempts}
      />
      <div className="max-w-7xl mx-auto px-6 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] overflow-x-hidden">
        <ControlPanel {...props} />
      </div>
      <LaunchToast launching={props.launching} launchProgress={props.launchProgress} />
    </div>
  );
}
