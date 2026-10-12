import { useState, useSyncExternalStore, type DependencyList } from "react";

const noopSnapshot = (): number => 0;

type MemoizedSubscribe = {
  deps: DependencyList;
  subscribe: () => () => void;
};

export function useMountSubscription(
  subscribe: () => void | (() => void),
  deps: DependencyList,
): void {
  const normalized = () => {
    const cleanup = subscribe();
    return typeof cleanup === "function" ? cleanup : () => undefined;
  };
  const [memo] = useState((): MemoizedSubscribe => ({ deps, subscribe: normalized }));
  const changed =
    memo.deps.length !== deps.length || memo.deps.some((dep, i) => !Object.is(dep, deps[i]));
  if (changed) {
    memo.deps = deps;
    memo.subscribe = normalized;
  }
  useSyncExternalStore(memo.subscribe, noopSnapshot, noopSnapshot);
}
