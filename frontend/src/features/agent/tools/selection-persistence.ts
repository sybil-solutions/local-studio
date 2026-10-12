// Single owner of the ToolSelection <-> persisted-tab-fields wire shape.
//
// Workspace persistence (workspace/store.ts) stores each pane tab as a JSON
// record that may carry the session's tool selection inline (`skills`,
// `promptTemplates`). This module is the only place that knows those field
// names and their normalization rules, so the live selection state in tools/
// and the persisted tab shape in workspace/ can't drift apart.

import type { ToolSelection } from "@/features/agent/tools/types";

export type PersistedToolSelectionFields = {
  skills?: ToolSelection["skills"];
  promptTemplates?: ToolSelection["promptTemplates"];
};

/**
 * Read a tool selection from a persisted pane tab record. Returns `null` when
 * the tab carries no selection (both lists missing, malformed, or empty) so
 * hydration skips it entirely.
 */
export function toolSelectionFromPersistedTab(tab: unknown): ToolSelection | null {
  if (!tab || typeof tab !== "object") return null;
  const fields = tab as PersistedToolSelectionFields;
  const skills = Array.isArray(fields.skills) ? fields.skills : [];
  const promptTemplates = Array.isArray(fields.promptTemplates) ? fields.promptTemplates : [];
  if (skills.length === 0 && promptTemplates.length === 0) {
    return null;
  }
  return { skills, promptTemplates };
}

/**
 * Serialize a tool selection to the optional fields spread onto a persisted
 * pane tab record. Empty lists are omitted (not written as `[]`) so the
 * persisted JSON stays byte-identical to the historical hand-rolled shape.
 */
export function persistedTabFieldsFromSelection(
  selection: ToolSelection,
): PersistedToolSelectionFields {
  return {
    ...(selection.skills.length > 0 ? { skills: selection.skills } : {}),
    ...(selection.promptTemplates.length > 0 ? { promptTemplates: selection.promptTemplates } : {}),
  };
}
