import type { DesktopBridge } from "../desktop/interfaces";

declare global {
  interface Window {
    localStudioDesktop?: DesktopBridge;
  }
}

export {};
