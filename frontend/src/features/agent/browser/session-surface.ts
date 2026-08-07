export type BrowserViewport = { height: number; width: number };

const DEFAULT_VIEWPORT: BrowserViewport = { height: 800, width: 1280 };

export class BrowserSessionSurface {
  private readonly controllers = new Set<AbortController>();
  private inheritedUrl = "";
  private serverUrl = "";
  private sessionId: string | null = null;
  private viewportState = DEFAULT_VIEWPORT;
  private viewportSessionId: string | null = null;

  enterSession(sessionId: string | null, desiredUrl: string): void {
    if (this.sessionId === sessionId) return;
    this.abortRequests();
    this.sessionId = sessionId;
    this.inheritedUrl = desiredUrl.trim();
    this.serverUrl = "";
    this.viewportState = DEFAULT_VIEWPORT;
    this.viewportSessionId = null;
  }

  requestController(sessionId: string | null): AbortController | null {
    if (!sessionId || sessionId !== this.sessionId) return null;
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  releaseRequest(controller: AbortController): void {
    this.controllers.delete(controller);
  }

  observeServerUrl(sessionId: string, url: string): void {
    if (sessionId === this.sessionId) this.serverUrl = url;
  }

  navigationTarget(sessionId: string | null, desiredUrl: string): string | null {
    const target = desiredUrl.trim();
    if (!sessionId || sessionId !== this.sessionId || !target || target === this.serverUrl) {
      return null;
    }
    return target === this.inheritedUrl ? null : target;
  }

  syncViewport(sessionId: string, viewport: BrowserViewport): boolean {
    if (sessionId !== this.sessionId) return false;
    const changed =
      this.viewportSessionId !== sessionId ||
      viewport.width !== this.viewportState.width ||
      viewport.height !== this.viewportState.height;
    this.viewportState = viewport;
    this.viewportSessionId = sessionId;
    return changed;
  }

  viewport(): BrowserViewport {
    return this.viewportState;
  }

  private abortRequests(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
