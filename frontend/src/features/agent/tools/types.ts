// Tool surface types — split into two pieces:
//
// 1. UI state (workspace-global): which side panel is open, panel width,
//    browser tool toggle, browser URL.
// 2. Per-session selection: which skills/templates the composer has armed for
//    a given session. Lives in a flat map keyed by SessionId so panes /
//    sessions stay independent of tool choice.

import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { SessionId } from "@/features/agent/runtime/types";

// Single source of truth for the right-sidebar tab ids. The `ComputerTab`
// union is derived from this list, and persistence validates against it, so a
// new tab only needs to be added here (plus its panel + label in the UI).
export const COMPUTER_TAB_IDS = [
  "status",
  "tools",
  "side-chat",
  "browser",
  "files",
  "diff",
  "terminal",
] as const;

export type ComputerTab = (typeof COMPUTER_TAB_IDS)[number];

// Which browsers the session arms for the model. "embedded" is the headless
// sandbox on its own; "chrome" arms the user's real browser as well, so the
// model chooses per task rather than the composer choosing for it.
export type BrowserBackend = "embedded" | "chrome";

export type BrowserState = {
  enabled: boolean;
  backend: BrowserBackend;
  url: string;
  input: string;
};

export type ComputerState = {
  open: boolean;
  tab: ComputerTab;
  tabs: ComputerTab[];
  width: number;
};

export type FileOpenRequest = {
  id: number;
  path: string;
};

export type ContextAttachRequest = {
  id: number;
  /** Short label shown on the composer chip (e.g. the file name). */
  label: string;
  /** Optional disk path so the attachment dedupes/links to the file. */
  path?: string;
  /** The text injected into the model context. */
  content: string;
};

/** Ask the right panel to open an existing session (e.g. a subagent's) in its
 *  side-chat pane. Same id-stamped shape as FileOpenRequest: the consumer
 *  reacts to a changed id, never to a re-render. */
export type SessionPreviewRequest = {
  id: number;
  piSessionId: string;
  title: string;
  /** The session's working directory — replay needs it to find the log. */
  cwd: string | null;
};

export type ToolSelection = {
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
};

export type ToolSelectionMap = ReadonlyMap<SessionId, ToolSelection>;

export const EMPTY_SELECTION: ToolSelection = {
  skills: [],
  promptTemplates: [],
};
