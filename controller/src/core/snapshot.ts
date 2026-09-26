import type { Snapshot } from "@local-studio/contracts";
import type { Services } from "../context";

export const buildSnapshot = (svc: Services): Snapshot => {
  const v = svc.runtime.view();
  return {
    at: Date.now(),
    machine: svc.runtime.machine(),
    gpus: v.gpus,
    groups: v.groups,
    models: v.models,
    endpoints: v.endpoints,
    launches: svc.lifecycle.progress(),
    cards: svc.metrics.cards(),
    engines: svc.metrics.engineRates(),
    activity: svc.metrics.activity(),
    discovery: v.discovery,
  };
};

export const snapshotKey = (s: Snapshot): string => JSON.stringify({ ...s, at: 0, machine: { ...s.machine, lastSeenAt: 0 } });
