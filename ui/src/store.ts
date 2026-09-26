import { useSyncExternalStore } from "react";
import type { ControllerEvent, EngineRates, FleetSnapshot, LaunchProgress, RecipeRow, RequestRecord, Snapshot } from "@local-studio/contracts/client";
import { type ConnState, events, get, setUnauthorizedHandler, via } from "./api";

export interface State {
  fleet: FleetSnapshot | null;
  requests: RequestRecord[];
  fresh: Set<string>;
  launches: Record<string, LaunchProgress>;
  engines: Record<string, EngineRates>;
  recipes: Record<string, RecipeRow[] | null>;
  conn: ConnState;
  retryMs: number | null;
  needKey: boolean;
  error: string | null;
  hist: Record<string, number[]>;
  now: number;
}

let state: State = {
  fleet: null,
  requests: [],
  fresh: new Set(),
  launches: {},
  engines: {},
  recipes: {},
  conn: "connecting",
  retryMs: null,
  needKey: false,
  error: null,
  hist: {},
  now: Date.now(),
};
const subs = new Set<() => void>();

export const getState = (): State => state;
export const setState = (patch: Partial<State> | ((s: State) => Partial<State>)): void => {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const useStore = <T>(sel: (s: State) => T): T => useSyncExternalStore(subscribe, () => sel(state));

const fleetFromSnapshot = (s: Snapshot): FleetSnapshot => ({
  at: s.at,
  self: s.machine.machineId,
  machines: [{ machineId: s.machine.machineId, peerId: null, online: true, error: null, snapshot: s }],
  peers: [],
  activity: s.activity,
  harnesses: [],
  workspaces: [],
});

const HIST = 90;

const track = (hist: Record<string, number[]>, f: FleetSnapshot): Record<string, number[]> => {
  const next = { ...hist };
  for (const m of f.machines)
    for (const g of m.snapshot?.gpus ?? []) if (g.utilPct !== null) next[`${m.machineId}/${g.key}`] = [...(next[`${m.machineId}/${g.key}`] ?? []), g.utilPct].slice(-HIST);
  return next;
};

export const applySnapshot = (s: Snapshot): void =>
  setState((st) => {
    if (!st.fleet) return { fleet: fleetFromSnapshot(s) };
    const f = st.fleet;
    const self = f.self || s.machine.machineId;
    const has = f.machines.some((m) => m.machineId === self);
    const entry = { machineId: self, peerId: null, online: true, error: null, snapshot: s };
    const machines = has ? f.machines.map((m) => (m.machineId === self ? { ...m, ...entry } : m)) : [entry, ...f.machines];
    const fleet = { ...f, self, machines, at: Math.max(f.at, s.at) };
    return { fleet, hist: track(st.hist, { ...fleet, machines: [entry] }) };
  });

export const applyFleet = (f: FleetSnapshot): void =>
  setState((st) => {
    const prevSelf = st.fleet?.machines.find((m) => m.machineId === f.self && m.peerId === null);
    const has = f.machines.some((m) => m.machineId === f.self);
    const machines = has || !prevSelf ? f.machines : [prevSelf, ...f.machines];
    return { fleet: { ...f, machines }, hist: track(st.hist, { ...f, machines: f.machines.filter((m) => m.peerId !== null) }) };
  });

const onEvent = (e: ControllerEvent): void => {
  switch (e.type) {
    case "snapshot":
      applySnapshot(e.data);
      break;
    case "fleet":
      applyFleet(e.data);
      break;
    case "request": {
      const id = e.data.id;
      setState((s) => {
        const fresh = new Set(s.fresh);
        fresh.add(id);
        return { requests: [e.data, ...s.requests.filter((r) => r.id !== id)].slice(0, 500), fresh };
      });
      setTimeout(() => {
        setState((s) => {
          if (!s.fresh.has(id)) return {};
          const fresh = new Set(s.fresh);
          fresh.delete(id);
          return { fresh };
        });
      }, 1500);
      break;
    }
    case "launch":
      setState((s) => ({ launches: { ...s.launches, [e.data.launchId]: e.data } }));
      break;
    case "engine":
      setState((s) => ({ engines: { ...s.engines, [e.data.modelId]: e.data } }));
      break;
    default:
      break;
  }
};

export const loadRecipes = async (machineId: string, peerId: string | null): Promise<void> => {
  const r = await get<RecipeRow[]>(via(peerId, "/api/recipes"));
  setState((s) => ({ recipes: { ...s.recipes, [machineId]: r.ok && Array.isArray(r.data) ? r.data : null } }));
};

export const loadAll = async (): Promise<void> => {
  const [fleet, snap, reqs] = await Promise.all([get<FleetSnapshot>("/api/fleet"), get<Snapshot>("/api/snapshot"), get<RequestRecord[]>("/api/metrics/requests?limit=200")]);
  if (fleet.ok && fleet.data && Array.isArray(fleet.data.machines)) applyFleet(fleet.data);
  if (snap.ok && snap.data?.machine) applySnapshot(snap.data);
  if (reqs.ok && Array.isArray(reqs.data)) setState({ requests: reqs.data });
  const err = !fleet.ok && !snap.ok ? snap.error : null;
  setState({ error: err });
  const f = getState().fleet;
  if (f) await Promise.all(f.machines.filter((m) => m.online).map((m) => loadRecipes(m.machineId, m.peerId)));
};

let stopEvents: (() => void) | null = null;

let ticking = false;

export const start = async (): Promise<void> => {
  if (!ticking) {
    ticking = true;
    setInterval(() => setState({ now: Date.now() }), 1000);
    setInterval(() => {
      const f = getState().fleet;
      if (f) f.machines.filter((m) => m.online).forEach((m) => void loadRecipes(m.machineId, m.peerId));
    }, 60_000);
  }
  setUnauthorizedHandler(() => setState({ needKey: true }));
  await loadAll();
  stopEvents?.();
  stopEvents = events(["snapshot", "fleet", "request", "launch", "engine"], onEvent, (conn, retryMs) => {
    setState({ conn, retryMs: retryMs ?? null });
    if (conn === "live" && wasDown) void loadAll();
    wasDown = conn === "retrying";
  });
};

let wasDown = false;

export const restart = async (): Promise<void> => {
  setState({ needKey: false });
  await start();
};
