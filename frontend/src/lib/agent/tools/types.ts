// Tool surface types — split into two pieces:
//
// 1. UI state (workspace-global): which side panel is open, panel width,
//    browser tool toggle, browser URL.
// 2. Per-session selection: which plugins/skills the composer has armed for
//    a given session. Lives in a flat map keyed by SessionId so panes /
//    sessions stay independent of tool choice.

import type {
  ComposerExtensionOverride,
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { SessionId } from "@/lib/agent/sessions/types";

export type ComputerTab =
  | "status"
  | "tools"
  | "canvas"
  | "side-chat"
  | "browser"
  | "files"
  | "diff"
  | "terminal"
  | "plugins";

export type BrowserState = {
  enabled: boolean;
  url: string;
  input: string;
};

export type ComputerState = {
  open: boolean;
  tab: ComputerTab;
  tabs: ComputerTab[];
  width: number;
  canvasEnabled: boolean;
  canvasText: string;
};

export type FileOpenRequest = {
  id: number;
  path: string;
};

export type ToolSelection = {
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
  /**
   * Per-turn Pi extension on/off overrides selected via the composer's
   * `/plugins` slash command. These layer on top of the persistent
   * `<agentDir>/extension-config/enabled.json` overrides — they do not write
   * to disk and only affect the next session start.
   */
  extensionOverrides: ComposerExtensionOverride[];
};

export type ToolSelectionMap = ReadonlyMap<SessionId, ToolSelection>;

export const EMPTY_SELECTION: ToolSelection = {
  plugins: [],
  skills: [],
  promptTemplates: [],
  extensionOverrides: [],
};
