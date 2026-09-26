import { useSyncExternalStore } from "react";

export type Route =
  | { view: "home" }
  | { view: "machine"; machineId: string }
  | { view: "model"; machineId: string; modelId: string }
  | { view: "recipes"; machineId: string | null }
  | { view: "metrics"; machineId: string | null }
  | { view: "agents"; model: string | null }
  | { view: "connect" };

export const parseRoute = (hash: string): Route => {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const p = path.split("/").map((x) => decodeURIComponent(x));
  const q = new URLSearchParams(query);
  switch (p[0]) {
    case "m":
      return p[1] ? { view: "machine", machineId: p[1] } : { view: "home" };
    case "model":
      return p[1] && p[2] ? { view: "model", machineId: p[1], modelId: p[2] } : { view: "home" };
    case "recipes":
      return { view: "recipes", machineId: p[1] || null };
    case "metrics":
      return { view: "metrics", machineId: p[1] || null };
    case "agents":
      return { view: "agents", model: q.get("model") };
    case "connect":
      return { view: "connect" };
    default:
      return { view: "home" };
  }
};

const sub = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

export const useHash = (): string => useSyncExternalStore(sub, () => location.hash);

export const go = (hash: string): void => {
  location.hash = hash;
};
