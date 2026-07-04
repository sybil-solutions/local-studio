export type QuickPanelHotkeyState = {
  hotkey: string;
  defaultHotkey: string;
};

export type QuickPanelHotkeyResult = {
  ok: boolean;
  hotkey: string;
  error?: string;
};

type QuickPanelBridge = {
  expand: () => Promise<void>;
  dismiss: () => Promise<void>;
  focusMainAndNavigate: (projectId: string, sessionId?: string) => Promise<void>;
  getHotkey?: () => Promise<QuickPanelHotkeyState>;
  setHotkey?: (hotkey: string) => Promise<QuickPanelHotkeyResult>;
};

export function getQuickPanelBridge(): QuickPanelBridge | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { localStudioDesktop?: { quickPanel?: QuickPanelBridge } })
      .localStudioDesktop?.quickPanel ?? null
  );
}
