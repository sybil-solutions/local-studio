// The single place in @local-studio/agent-runtime allowed to touch globalThis.
//
// The runtime package is bundled into the Next server (transpilePackages), so
// `next dev` HMR can re-evaluate its modules independently for different route
// bundles. Long-lived runtime state (the session manager, the browser host,
// the Chrome process handle, resource diagnostics) must survive those
// re-evaluations and be shared across route bundles, so each singleton is
// registered here under a stable key and resolved through globalThis on
// creation. In production builds every route shares one module instance and
// this is a plain one-time initialization.
//
// Do NOT add globalThis access anywhere else in this package; add a
// getGlobalSingleton() call here-based singleton instead.

const GLOBAL_KEY = "__localStudioAgentRuntimeInstances";

type InstanceRegistry = Map<string, unknown>;

function registry(): InstanceRegistry {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: InstanceRegistry;
  };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

export function getGlobalSingleton<T>(key: string, create: () => T): T {
  const map = registry();
  if (!map.has(key)) map.set(key, create());
  return map.get(key) as T;
}
