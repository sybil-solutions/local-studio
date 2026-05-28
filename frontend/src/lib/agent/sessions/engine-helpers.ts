import { runtimeStatusLooksActive } from "@/lib/agent/session";
import type { RuntimeStatus } from "./api";
import type { Session, SessionId } from "./types";

export type ResumeRuntimeTarget = {
  after: number;
  piSessionId: string | null;
  runtimeSessionId: string;
  sessionId: SessionId;
};

export function resolveRuntimeSessionId(
  session: Pick<Session, "runtimeSessionId"> | null | undefined,
  fallbackRuntimeSessionId: string,
): string {
  return session?.runtimeSessionId || fallbackRuntimeSessionId;
}

export function runtimeIsActiveForPiSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string | null | undefined,
): boolean {
  return Boolean(
    runtimeStatus &&
    runtimeStatusLooksActive(runtimeStatus) &&
    (!runtimeStatus.piSessionId || !piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}

export function runtimeCanHydrateCanonicalSession(
  runtimeStatus: RuntimeStatus | null | undefined,
  piSessionId: string,
): boolean {
  return Boolean(
    runtimeStatus?.active === true &&
    (!runtimeStatus.piSessionId || runtimeStatus.piSessionId === piSessionId),
  );
}

export function resolveResumeRuntimeTarget(
  tabs: Session[],
  activeTabId: SessionId,
  fallbackRuntimeSessionId: string,
): ResumeRuntimeTarget | null {
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active?.status !== "running" && active?.status !== "starting") return null;
  return {
    after: active.lastEventSeq ?? 0,
    piSessionId: active.piSessionId,
    runtimeSessionId: resolveRuntimeSessionId(active, fallbackRuntimeSessionId),
    sessionId: activeTabId,
  };
}
