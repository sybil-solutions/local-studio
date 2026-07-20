import type { WebContents } from "electron";

type NavigationState = { generation: number };

const states = new WeakMap<WebContents, NavigationState>();

export function rendererNavigationGeneration(contents: WebContents): number {
  const existing = states.get(contents);
  if (existing) return existing.generation;
  const state: NavigationState = { generation: 0 };
  states.set(contents, state);
  contents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) state.generation += 1;
  });
  return state.generation;
}
