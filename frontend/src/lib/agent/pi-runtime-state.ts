import type { LoggedPiEvent, PiAgentStatus, PiContextUsage } from "./pi-runtime-types";

export function piStatusFromEvents(input: {
  running: boolean;
  activePromptCount: number;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  eventLog: LoggedPiEvent[];
  contextUsage?: PiContextUsage | null;
}): PiAgentStatus {
  return {
    running: input.running,
    active: input.activePromptCount > 0,
    modelId: input.modelId,
    cwd: input.cwd,
    piSessionId: input.piSessionId,
    agentDir: input.agentDir,
    eventSeq: input.eventSeq,
    lastError: input.lastError,
    contextUsage: input.contextUsage ?? null,
  };
}

export function piEventsAfter(eventLog: LoggedPiEvent[], seq: number): LoggedPiEvent[] {
  const floor = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0;
  return eventLog.filter((entry) => entry.seq > floor);
}
