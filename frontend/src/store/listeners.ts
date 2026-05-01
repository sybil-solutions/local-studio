/**
 * Module-level window listeners that sync browser events into the app store.
 * Import this file once (e.g. from store/index.ts) to activate.
 */
import { useAppStore } from "./app-store";

let lastWasMobile = false;

if (typeof window !== "undefined") {
  // --- Resize → sidebar.collapsed ---
  const onResize = () => {
    const mobile = window.innerWidth < 768;
    if (mobile !== lastWasMobile) {
      lastWasMobile = mobile;
    }
    if (mobile && !useAppStore.getState().sidebar.collapsed) {
      useAppStore.getState().setSidebarCollapsed(true);
    }
  };
  window.addEventListener("resize", onResize);
  onResize();

  // --- Custom event: vllm:toggle-sidebar ---
  window.addEventListener("vllm:toggle-sidebar", ((event: CustomEvent<{ open?: boolean }>) => {
    const requested = event?.detail?.open;
    if (typeof requested === "boolean") {
      useAppStore.getState().setSidebarMobileOpen(requested);
    } else {
      useAppStore.getState().toggleSidebarMobileOpen();
    }
  }) as EventListener);
}
