import type { McpConnection } from "./mcp-client";

type ConnectorPoolState = {
  active?: McpConnection;
  creating?: Promise<McpConnection>;
  closing?: Promise<void>;
  generation: number;
  pending: Set<McpConnection>;
};

const states = new Map<string, ConnectorPoolState>();
const snapshotConnections = new Set<McpConnection>();
const snapshotClosings = new Map<McpConnection, Promise<void>>();

function stateFor(connectorId: string): ConnectorPoolState {
  const existing = states.get(connectorId);
  if (existing) return existing;
  const created: ConnectorPoolState = { generation: 0, pending: new Set() };
  states.set(connectorId, created);
  return created;
}

function removeIdleState(connectorId: string, state: ConnectorPoolState): void {
  if (!state.active && !state.creating && !state.closing && state.pending.size === 0) {
    states.delete(connectorId);
  }
}

export async function getOrCreatePooledConnection(
  connectorId: string,
  create: () => Promise<McpConnection>,
): Promise<McpConnection> {
  while (true) {
    const state = stateFor(connectorId);
    if (state.closing) {
      await state.closing;
      continue;
    }
    if (state.pending.size > 0) {
      await closePooledConnection(connectorId);
      continue;
    }
    if (state.active) return state.active;
    if (state.creating) return state.creating;
    const generation = state.generation;
    let creating: Promise<McpConnection>;
    creating = Promise.resolve()
      .then(create)
      .then((connection) => {
        if (state.generation !== generation || state.closing) {
          state.pending.add(connection);
          throw new Error("Connector closed while connecting");
        }
        state.active = connection;
        return connection;
      })
      .finally(() => {
        if (state.creating === creating) state.creating = undefined;
        removeIdleState(connectorId, state);
      });
    state.creating = creating;
    return creating;
  }
}

async function drainState(state: ConnectorPoolState): Promise<void> {
  await state.creating?.catch(() => undefined);
  if (state.active) {
    state.pending.add(state.active);
    state.active = undefined;
  }
  const targets = [...state.pending];
  const results = await Promise.allSettled(
    targets.map((target) => Promise.resolve().then(() => target.close())),
  );
  const failures: unknown[] = [];
  results.forEach((result, index) => {
    const target = targets[index];
    if (!target) return;
    if (result.status === "fulfilled") state.pending.delete(target);
    else failures.push(result.reason);
  });
  if (failures.length) throw new AggregateError(failures, "Connector shutdown failed");
}

export async function closePooledConnection(connectorId: string): Promise<void> {
  const state = stateFor(connectorId);
  if (state.closing) return state.closing;
  state.generation += 1;
  const closing = drainState(state);
  state.closing = closing;
  try {
    await closing;
  } finally {
    if (state.closing === closing) state.closing = undefined;
    removeIdleState(connectorId, state);
  }
}

export async function closePendingPooledConnections(): Promise<void> {
  await Promise.all(
    [...states.entries()]
      .filter(([, state]) => state.pending.size > 0)
      .map(([connectorId]) => closePooledConnection(connectorId)),
  );
}

export function trackSnapshotConnection(connection: McpConnection): void {
  snapshotConnections.add(connection);
}

export async function closeSnapshotConnection(connection: McpConnection): Promise<void> {
  const existing = snapshotClosings.get(connection);
  if (existing) return existing;
  const closing = Promise.resolve()
    .then(() => connection.close())
    .then(() => {
      snapshotConnections.delete(connection);
    });
  snapshotClosings.set(connection, closing);
  try {
    await closing;
  } finally {
    if (snapshotClosings.get(connection) === closing) snapshotClosings.delete(connection);
  }
}

export async function closeSnapshotConnections(): Promise<void> {
  const results = await Promise.allSettled(
    [...snapshotConnections].map(closeSnapshotConnection),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) throw new AggregateError(failures, "Connector shutdown failed");
}

export function hasPendingPooledConnections(): boolean {
  return [...states.values()].some(
    (state) => Boolean(state.creating || state.closing || state.pending.size),
  ) || snapshotConnections.size > 0;
}
