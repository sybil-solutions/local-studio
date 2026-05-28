// In-memory bridge between the pi extension's HTTP calls and the renderer's
// embedded <webview>. The renderer holds a long-lived SSE subscription and
// posts results back via /api/agent/browser/result. Each pending command
// resolves the promise returned to the pi extension when its result arrives.

import { EventEmitter } from "node:events";

export type BrowserCommand = {
  id: string;
  verb: string;
  sessionId?: string;
  payload: Record<string, unknown>;
};

export type BrowserResult = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type PendingCommand = {
  resolve: (result: BrowserResult) => void;
  reject: (error: Error) => void;
};

function waitForCommandListener(emitter: EventEmitter, timeoutMs: number): Promise<boolean> {
  if (emitter.listenerCount("command") > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      emitter.off("newListener", onNewListener);
      resolve(false);
    }, timeoutMs);
    const onNewListener = (eventName: string | symbol) => {
      if (eventName !== "command") return;
      clearTimeout(timer);
      emitter.off("newListener", onNewListener);
      queueMicrotask(() => resolve(emitter.listenerCount("command") > 0));
    };
    emitter.on("newListener", onNewListener);
  });
}

class BrowserBridge extends EventEmitter {
  private pending = new Map<string, PendingCommand>();
  private seq = 0;

  async enqueue(
    verb: string,
    payload: Record<string, unknown>,
    sessionId?: string,
  ): Promise<BrowserResult> {
    const connected = await waitForCommandListener(this, 5_000);
    if (!connected) {
      return Promise.reject(
        new Error(`Browser command '${verb}' could not run because no browser panel is connected.`),
      );
    }

    const id = `browser-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
    const command: BrowserCommand = { id, verb, ...(sessionId ? { sessionId } : {}), payload };
    return new Promise<BrowserResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.emit("command", command);

      // Don't let a wedged renderer hang the pi turn forever.
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Browser command '${verb}' timed out — is the browser panel open?`));
      }, 30_000);

      // Wrap the original handlers so the timer is cleared.
      const wrap = this.pending.get(id)!;
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          wrap.resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          wrap.reject(error);
        },
      });
    });
  }

  resolve(result: BrowserResult): boolean {
    const pending = this.pending.get(result.id);
    if (!pending) return false;
    this.pending.delete(result.id);
    pending.resolve(result);
    return true;
  }
}

const globalForBridge = globalThis as typeof globalThis & {
  __vllmStudioBrowserBridge?: BrowserBridge;
};

export const browserBridge = globalForBridge.__vllmStudioBrowserBridge ?? new BrowserBridge();
globalForBridge.__vllmStudioBrowserBridge = browserBridge;
