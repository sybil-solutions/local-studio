export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Electron's bundled Node/undici races IPv4/IPv6 with a short (~250ms)
  // per-attempt connect timeout. On hosts with broken IPv6 or slow
  // Cloudflare-fronted backends (which can take ~1s to connect), every outbound
  // fetch aborts with ETIMEDOUT and the proxy surfaces 500/502. Raise the
  // family-autoselection attempt timeout so the connection can fall back to a
  // reachable address. Harmless under healthy networks and other runtimes.
  const net = await import("node:net");
  const setTimeoutFn = (
    net as unknown as {
      setDefaultAutoSelectFamilyAttemptTimeout?: (value: number) => void;
    }
  ).setDefaultAutoSelectFamilyAttemptTimeout;
  if (typeof setTimeoutFn !== "function") return;
  const configured = Number(process.env.LOCAL_STUDIO_AUTOSELECT_FAMILY_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 2000;
  setTimeoutFn(Math.max(timeoutMs, 250));
}
