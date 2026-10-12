import { useCallback, useRef, useState } from "react";
import { createApiClient } from "@/lib/api/create-api-client";
import { BACKEND_URL_CHANGED_EVENT, getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { effectInterval } from "@/lib/effect-timers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

function processKey(process: ProcessInfo | null): string {
  if (!process) return "";
  return [
    process.pid,
    process.backend,
    process.served_model_name ?? "",
    process.model_path ?? "",
  ].join("|");
}

let lastRecipe: RecipeWithStatus | null = null;
let lastRecipeProcessKey = "";
const FAST_LOG_REQUEST = { timeout: 3_000, retries: 0 } as const;

type DashboardRecipesCache = {
  currentRecipe: RecipeWithStatus | null;
  logs: string[];
  processKey: string;
  recipes: RecipeWithStatus[];
};

type DashboardApi = ReturnType<typeof createApiClient>;

type LogSessionSummary = {
  id: string;
  recipe_id?: string;
  status: string;
  backend?: string;
  model_path?: string;
  model?: string;
  started_at?: string;
  created_at?: string;
};

const cacheByController = new Map<string, DashboardRecipesCache>();

function controllerKey(): string {
  return getStoredBackendUrl() || "default";
}

function apiForController(key: string): DashboardApi {
  const apiKey = getApiKey();
  return createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: key === "default" ? undefined : key,
    ...(apiKey ? { apiKeyOverride: apiKey } : {}),
  });
}

function cacheState(
  key: string,
  process: ProcessInfo | null,
  recipes: RecipeWithStatus[],
  currentRecipe: RecipeWithStatus | null,
  logs: string[],
): void {
  cacheByController.set(key, {
    currentRecipe,
    logs,
    processKey: processKey(process),
    recipes,
  });
}

function cachedState(key: string): DashboardRecipesCache | null {
  return cacheByController.get(key) ?? null;
}

export function resolveDashboardRecipe(
  process: ProcessInfo | null,
  recipes: RecipeWithStatus[],
  previous: RecipeWithStatus | null,
): RecipeWithStatus | null {
  if (!process) return null;
  return recipes.find((recipe) => recipe.status === "running") ?? previous;
}

export function resolveDashboardLogs(
  previous: string[],
  previousProcessKey: string,
  process: ProcessInfo | null,
  next: string[] | null,
): string[] {
  const sameProcess = Boolean(process && previousProcessKey === processKey(process));
  if (sameProcess && previous.length > 0 && (!next || next.length === 0)) return previous;
  return next ?? [];
}

function selectTargetLogSession(
  sessions: LogSessionSummary[],
  runningRecipe: RecipeWithStatus | null,
  process: ProcessInfo | null,
): LogSessionSummary | null {
  if (sessions.length === 0) return null;
  const timestamp = (session: LogSessionSummary) =>
    Date.parse(session.started_at || session.created_at || "") || 0;
  const sorted = [...sessions].sort((left, right) => timestamp(right) - timestamp(left));
  const running = sorted.filter((session) => session.status === "running");

  if (process) {
    const usable = (list: LogSessionSummary[]) =>
      list.filter((session) => session.id !== "controller");
    const runningUsable = usable(running);
    const sortedUsable = usable(sorted);
    const matches = (session: LogSessionSummary) => {
      if (session.model_path && process.model_path) {
        return session.model_path === process.model_path;
      }
      if (session.model && process.served_model_name) {
        return session.model === process.served_model_name;
      }
      return session.backend === process.backend;
    };
    const byProcess = runningUsable.find(matches) || sortedUsable.find(matches);
    if (byProcess) return byProcess;

    const servedModel = process.served_model_name?.toLowerCase();
    if (servedModel) {
      const byName = sortedUsable.find((session) => session.id.toLowerCase().includes(servedModel));
      if (byName) return byName;
    }

    if (runningRecipe) {
      const byRecipe =
        runningUsable.find((session) => session.recipe_id === runningRecipe.id) ||
        sortedUsable.find((session) => session.recipe_id === runningRecipe.id);
      if (byRecipe) return byRecipe;
    }

    return runningUsable[0] || sortedUsable[0] || running[0] || sorted[0] || null;
  }

  if (runningRecipe) {
    const byRecipe =
      running.find((session) => session.recipe_id === runningRecipe.id) ||
      sorted.find((session) => session.recipe_id === runningRecipe.id);
    if (byRecipe) return byRecipe;
  }

  return running[0] || sorted[0] || null;
}

export function useDashboardRecipes(currentProcess: ProcessInfo | null) {
  const initialCache = cachedState(controllerKey());
  const [recipes, setRecipes] = useState<RecipeWithStatus[]>(() => initialCache?.recipes ?? []);
  const [currentRecipe, setCurrentRecipe] = useState<RecipeWithStatus | null>(
    () =>
      initialCache?.currentRecipe ??
      (lastRecipe && lastRecipeProcessKey === processKey(currentProcess) ? lastRecipe : null),
  );
  const [logs, setLogs] = useState<string[]>(() => initialCache?.logs ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const processRef = useRef(currentProcess);
  const recipeRef = useRef(currentRecipe);
  const recipesRef = useRef(recipes);
  const logsRef = useRef(logs);
  processRef.current = currentProcess;
  recipeRef.current = currentRecipe;
  recipesRef.current = recipes;
  logsRef.current = logs;
  const activeProcessKey = processKey(currentProcess);

  const applyCachedState = useCallback((key: string) => {
    const cached = cachedState(key);
    setRecipes(cached?.recipes ?? []);
    setCurrentRecipe(cached?.currentRecipe ?? null);
    setLogs(cached?.logs ?? []);
    setLoading(!cached);
  }, []);

  const refreshLogs = useCallback(
    async (
      client: DashboardApi,
      runningRecipe: RecipeWithStatus | null,
      process: ProcessInfo | null,
      limit = 220,
    ) => {
      const sessions = await client.getLogSessions(FAST_LOG_REQUEST);
      const list = sessions.sessions || [];
      if (list.length === 0) return [];
      const targetSession = selectTargetLogSession(list, runningRecipe, process);
      if (!targetSession) return [];
      const logData = await client.getLogs(targetSession.id, limit, FAST_LOG_REQUEST);
      return logData.logs || [];
    },
    [],
  );

  const reload = useCallback(
    async (targetKey = controllerKey()) => {
      const client = apiForController(targetKey);
      const process = processRef.current;
      try {
        const data = await client.getRecipes();
        if (controllerKey() !== targetKey) return;
        const list = data.recipes || [];
        setRecipes(list);

        const cachedRecipe = cachedState(targetKey)?.currentRecipe ?? recipeRef.current;
        const resolved = resolveDashboardRecipe(process, list, cachedRecipe);
        setCurrentRecipe(resolved);
        const key = processKey(process);
        lastRecipe = resolved && key ? resolved : null;
        lastRecipeProcessKey = resolved && key ? key : "";
        const nextLogs = await refreshLogs(client, resolved, process).catch(() => null);
        if (controllerKey() !== targetKey) return;
        const cached = cachedState(targetKey);
        const resolvedLogs = resolveDashboardLogs(
          cached?.logs ?? logsRef.current,
          cached?.processKey ?? "",
          process,
          nextLogs,
        );
        setLogs(resolvedLogs);
        cacheState(targetKey, process, list, resolved, resolvedLogs);
      } catch (e) {
        console.error("Failed to load recipes:", e);
      } finally {
        if (controllerKey() === targetKey) setLoading(false);
      }
    },
    [refreshLogs],
  );

  useMountSubscription(() => {
    void reload();
  }, [reload]);
  useMountSubscription(() => {
    const handler: EventListener = () => {
      void reload();
    };
    window.addEventListener("vllm:recipe-event", handler);
    return () => {
      window.removeEventListener("vllm:recipe-event", handler);
    };
  }, [reload]);
  useMountSubscription(() => {
    const handler: EventListener = () => {
      const key = controllerKey();
      applyCachedState(key);
      void reload(key);
    };
    window.addEventListener(BACKEND_URL_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(BACKEND_URL_CHANGED_EVENT, handler);
    };
  }, [applyCachedState, reload]);
  useMountSubscription(() => {
    const process = processRef.current;
    if (!process) return;
    let cancelled = false;
    const targetKey = controllerKey();
    const client = apiForController(targetKey);
    const poll = async () => {
      if (cancelled) return;
      const nextLogs = await refreshLogs(client, recipeRef.current, process).catch(() => null);
      if (cancelled || controllerKey() !== targetKey) return;
      const cached = cachedState(targetKey);
      const resolvedLogs = resolveDashboardLogs(
        cached?.logs ?? logsRef.current,
        cached?.processKey ?? "",
        process,
        nextLogs,
      );
      setLogs(resolvedLogs);
      cacheState(targetKey, process, recipesRef.current, recipeRef.current, resolvedLogs);
    };
    void poll();
    const timer = effectInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      timer.cancel();
    };
  }, [activeProcessKey, refreshLogs]);

  return { recipes, currentRecipe, logs, loading, reload };
}
