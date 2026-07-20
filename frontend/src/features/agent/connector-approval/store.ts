"use client";

import { useSyncExternalStore } from "react";
import { Effect, Fiber, Schedule, Schema } from "effect";
import {
  ConnectorApprovalsResponseSchema,
  type ConnectorApprovalView,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";

type ApprovalSnapshot = {
  approvals: readonly ConnectorApprovalView[];
  decidingId: string | null;
  error: string | null;
};

const POLL_INTERVAL_MS = 500;
const listeners = new Set<() => void>();
let snapshot: ApprovalSnapshot = { approvals: [], decidingId: null, error: null };
let snapshotKey = "[]";
let pollFiber: Fiber.Fiber<number, never> | null = null;
let desktopBridgePromise: Promise<
  NonNullable<Window["localStudioDesktop"]>["connectorApprovals"] | null
> | null = null;

function emit(next: ApprovalSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

function connectorApprovalBridge(): Promise<
  NonNullable<Window["localStudioDesktop"]>["connectorApprovals"] | null
> {
  if (desktopBridgePromise) return desktopBridgePromise;
  desktopBridgePromise = (async () => {
    const desktop = window.localStudioDesktop;
    if (!desktop) return null;
    const runtime = await desktop.getRuntime();
    if (runtime.mode === "dev-server") return null;
    if (runtime.mode !== "embedded-standalone") {
      throw new Error("Desktop approval transport is unavailable");
    }
    return desktop.connectorApprovals;
  })();
  return desktopBridgePromise;
}

async function httpApprovals(): Promise<unknown> {
  const response = await fetch("/api/agent/connectors/approvals", { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `HTTP ${response.status}`));
  return body;
}

async function listedApprovals(): Promise<readonly ConnectorApprovalView[]> {
  const bridge = await connectorApprovalBridge();
  const body = bridge ? await bridge.list() : await httpApprovals();
  return Schema.decodeUnknownSync(ConnectorApprovalsResponseSchema)(body).approvals;
}

const refreshEffect = Effect.tryPromise({
  try: listedApprovals,
  catch: (error) => (error instanceof Error ? error : new Error(String(error))),
}).pipe(
  Effect.match({
    onFailure: (error) => {
      if (snapshot.error !== error.message) emit({ ...snapshot, error: error.message });
    },
    onSuccess: (approvals) => {
      const nextKey = JSON.stringify(approvals);
      if (nextKey === snapshotKey && snapshot.error === null) return;
      snapshotKey = nextKey;
      emit({ ...snapshot, approvals, error: null });
    },
  }),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!pollFiber) {
    pollFiber = Effect.runFork(
      refreshEffect.pipe(Effect.repeat(Schedule.spaced(POLL_INTERVAL_MS))),
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size || !pollFiber) return;
    void Effect.runPromise(Fiber.interrupt(pollFiber));
    pollFiber = null;
  };
}

function getSnapshot(): ApprovalSnapshot {
  return snapshot;
}

export function useConnectorApprovals(): ApprovalSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function decideConnectorApproval(
  requestId: string,
  decision: "approve" | "deny",
): Promise<void> {
  emit({ ...snapshot, decidingId: requestId, error: null });
  return Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        const bridge = await connectorApprovalBridge();
        if (bridge) {
          await bridge.decide(requestId, decision);
          return;
        }
        const response = await fetch("/api/agent/connectors/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: requestId, decision }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(body, `HTTP ${response.status}`));
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          emit({ ...snapshot, decidingId: null, error: error.message });
        },
        onSuccess: () => {
          snapshotKey = JSON.stringify(
            snapshot.approvals.filter((approval) => approval.id !== requestId),
          );
          emit({
            approvals: snapshot.approvals.filter((approval) => approval.id !== requestId),
            decidingId: null,
            error: null,
          });
        },
      }),
    ),
  );
}
