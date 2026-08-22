// The one PTY bridge for every terminal, desktop and browser alike: real
// server-side shells in the agent runtime, reached through
// /api/agent/terminal/pty/*. Output arrives over an SSE stream (base64
// frames); input/resize/close are plain POSTs — the layout's global fetch
// patch attaches the CSRF header to every mutation.
//
// open() resolves once the snapshot (replay) frame lands, then data/exit
// listeners fire globally with the session id. The stream auto-reconnects;
// each reconnect re-delivers a snapshot which the panel applies with a
// terminal reset, so no output is duplicated or lost across network blips.

type DataListener = (id: string, chunk: string) => void;
type ExitListener = (id: string, info: { exitCode: number; signal: number | null }) => void;
type SnapshotListener = (id: string, replay: string) => void;

export type WebPtyBridge = {
  open(opts: {
    cwd?: string;
    cols?: number;
    rows?: number;
    ownerKey?: string;
  }): Promise<{ id: string; replay?: string; reused?: boolean }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  closeOwner(ownerKey: string): Promise<void>;
  onData(listener: DataListener): () => void;
  onExit(listener: ExitListener): () => void;
  onSnapshot(listener: SnapshotListener): () => void;
  detach(id: string): void;
};

type StreamState = { abort: AbortController; closed: boolean; replay: string };

const dataListeners = new Set<DataListener>();
const exitListeners = new Set<ExitListener>();
const snapshotListeners = new Set<SnapshotListener>();
const streams = new Map<string, StreamState>();

const RECONNECT_DELAY_MS = 1_500;
const MAX_RECONNECT_ATTEMPTS = 20;
// Mirror the server-side pty-service MAX_REPLAY_CHARS. We keep a client-side
// copy of the bounded scrollback per live stream so a reattach that *reuses* a
// still-running stream (a second pane on the same ownerKey, or a fresh xterm
// boot that races the old stream's teardown) can be handed the same buffer the
// server holds — the reuse path never receives its own `snapshot` frame, so
// without this it would render blank. See issue #287.
export const MAX_STREAM_REPLAY_CHARS = 200_000;

export function appendStreamReplay(prev: string, chunk: string): string {
  const next = prev + chunk;
  return next.length > MAX_STREAM_REPLAY_CHARS ? next.slice(-MAX_STREAM_REPLAY_CHARS) : next;
}

function decodeBase64(value: string): string {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

async function postJson(pathname: string, body: unknown): Promise<Response> {
  return fetch(pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type SseFrame = { event: string; data: string };

export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = buffer;
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary < 0) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0 || event !== "message") {
      frames.push({ event, data: dataLines.join("\n") });
    }
  }
  return { frames, rest };
}

function dispatchFrame(id: string, frame: SseFrame, onFirstSnapshot: (replay: string) => void) {
  if (frame.event === "snapshot") {
    const replay = decodeBase64(frame.data);
    const state = streams.get(id);
    // A snapshot is the authoritative full buffer (initial attach or reconnect):
    // replace, don't append.
    if (state) state.replay = appendStreamReplay("", replay);
    onFirstSnapshot(replay);
    for (const listener of snapshotListeners) listener(id, replay);
    return;
  }
  if (frame.event === "exit" || frame.event === "gone") {
    const info = (() => {
      try {
        const parsed = JSON.parse(frame.data) as { exitCode?: number; signal?: number | null };
        return { exitCode: parsed.exitCode ?? 0, signal: parsed.signal ?? null };
      } catch {
        return { exitCode: 0, signal: null };
      }
    })();
    const state = streams.get(id);
    if (state) state.closed = true;
    for (const listener of exitListeners) listener(id, info);
    return;
  }
  if (frame.event === "message" && frame.data) {
    const chunk = decodeBase64(frame.data);
    if (chunk) {
      const state = streams.get(id);
      if (state) state.replay = appendStreamReplay(state.replay, chunk);
      for (const listener of dataListeners) listener(id, chunk);
    }
  }
}

async function runStream(
  id: string,
  state: StreamState,
  onFirstSnapshot: (replay: string) => void,
): Promise<void> {
  let attempts = 0;
  while (!state.closed && attempts < MAX_RECONNECT_ATTEMPTS) {
    try {
      const response = await fetch(`/api/agent/terminal/pty/stream?id=${encodeURIComponent(id)}`, {
        signal: state.abort.signal,
        cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      attempts = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) dispatchFrame(id, frame, onFirstSnapshot);
        if (state.closed) return;
      }
    } catch {
      if (state.abort.signal.aborted || state.closed) return;
    }
    if (state.closed || state.abort.signal.aborted) return;
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  }
}

export const webPtyBridge: WebPtyBridge = {
  async open(opts) {
    const response = await postJson("/api/agent/terminal/pty/open", {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      ownerKey: opts.ownerKey,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? `PTY open failed (${response.status})`);
    }
    const { id, reused } = (await response.json()) as { id: string; reused?: boolean };

    // One stream per session id; a second panel attach reuses the running one.
    // Hand the reusing attach the buffer we've been mirroring so it can render
    // the same scrollback the first attach sees — the shared stream won't emit
    // a fresh `snapshot` frame just for this new consumer (issue #287).
    const existing = streams.get(id);
    if (existing && !existing.closed) return { id, reused, replay: existing.replay };

    const state: StreamState = { abort: new AbortController(), closed: false, replay: "" };
    streams.set(id, state);
    const firstSnapshot = new Promise<string>((resolve) => {
      let resolved = false;
      void runStream(id, state, (replay) => {
        if (resolved) return;
        resolved = true;
        resolve(replay);
      }).finally(() => {
        if (!resolved) {
          resolved = true;
          resolve("");
        }
        if (streams.get(id) === state) streams.delete(id);
      });
    });
    const replay = await firstSnapshot;
    return { id, replay, reused };
  },

  async write(id, data) {
    await postJson("/api/agent/terminal/pty/input", { id, data });
  },

  async resize(id, cols, rows) {
    await postJson("/api/agent/terminal/pty/resize", { id, cols, rows });
  },

  // Kill the shell behind an ownerKey (the persistent-terminal tab is gone for
  // good) rather than leaving it running for a reattach.
  async closeOwner(ownerKey) {
    await postJson("/api/agent/terminal/pty/close", { ownerKey });
  },

  onData(listener) {
    dataListeners.add(listener);
    return () => dataListeners.delete(listener);
  },

  onExit(listener) {
    exitListeners.add(listener);
    return () => exitListeners.delete(listener);
  },

  onSnapshot(listener) {
    snapshotListeners.add(listener);
    return () => snapshotListeners.delete(listener);
  },

  // Stop streaming output for this id (the shell keeps running server-side).
  detach(id) {
    const state = streams.get(id);
    if (!state) return;
    state.closed = true;
    state.abort.abort();
    streams.delete(id);
  },
};
