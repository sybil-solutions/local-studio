import type { Automation, AutomationSchedule } from "@shared/agent/automation";

export type AutomationFilter = "all" | "active" | "paused";

export type AutomationDraft = {
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  schedule: AutomationSchedule;
};

export const NEW_AUTOMATION_DRAFT: AutomationDraft = {
  name: "",
  prompt: "",
  modelId: "",
  cwd: "",
  schedule: { kind: "daily", time: "08:00" },
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function draftFromAutomation(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    modelId: automation.modelId,
    cwd: automation.cwd,
    schedule: automation.schedule,
  };
}

export function scheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.kind === "interval") {
    if (schedule.minutes === 60) return "Every hour";
    if (schedule.minutes > 60 && schedule.minutes % 60 === 0) {
      return `Every ${schedule.minutes / 60} hours`;
    }
    return `Every ${schedule.minutes} minutes`;
  }
  if (schedule.kind === "daily") {
    return `${schedule.weekdaysOnly ? "Weekdays" : "Daily"} at ${schedule.time}`;
  }
  return `${WEEKDAYS[schedule.day] ?? "Monday"} at ${schedule.time}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";
  const delta = timestamp - Date.now();
  const absolute = Math.abs(delta);
  const suffix = delta >= 0 ? "from now" : "ago";
  if (absolute < 60_000) return delta >= 0 ? "in less than a minute" : "less than a minute ago";
  if (absolute < 3_600_000) return `${Math.round(absolute / 60_000)}m ${suffix}`;
  if (absolute < 86_400_000) return `${Math.round(absolute / 3_600_000)}h ${suffix}`;
  return `${Math.round(absolute / 86_400_000)}d ${suffix}`;
}

export function filterAutomations(
  automations: readonly Automation[],
  query: string,
  filter: AutomationFilter,
): Automation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return automations.filter((automation) => {
    if (filter !== "all" && automation.status !== filter) return false;
    if (!normalizedQuery) return true;
    return [automation.name, automation.prompt, automation.modelId, automation.cwd]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function draftIsValid(draft: AutomationDraft): boolean {
  return Boolean(draft.name.trim() && draft.prompt.trim() && draft.modelId.trim());
}
