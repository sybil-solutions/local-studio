import { createContext } from "react";
import type { WorkspaceState } from "@/features/agent/workspace/types";

export type ComposerFocusContextValue = {
  tabId: string | null;
  composerFocusIntent: WorkspaceState["composerFocusIntent"];
};

export const ComposerFocusContext = createContext<ComposerFocusContextValue>({
  tabId: null,
  composerFocusIntent: undefined,
});
