import { Effect } from "effect";
import type { Dispatch, SetStateAction } from "react";
import api from "@/lib/api/client";
import type {
  EngineBackend,
  EngineJob,
  ModelDownload,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { isManagedServeRuntimeTarget } from "@/lib/serve-runtime";
import { describeFailedEngineJob } from "@/features/settings/runtime-targets";
import { buildStarterRecipe } from "./setup-helpers";
import { finishRuntimeJobEffect, requestEffect } from "./use-setup-effects";

export const markSetupComplete = (): void => {
  try {
    localStorage.setItem("local-studio-setup-complete", "true");
  } catch {}
};

export function saveSettingsEffect(
  modelsDir: string,
  {
    setSettings,
    setModelsDir,
    setHardwareConfirmed,
    setStep,
    setError,
    setSavingSettings,
  }: {
    setSettings: Dispatch<SetStateAction<StudioSettings | null>>;
    setModelsDir: Dispatch<SetStateAction<string>>;
    setHardwareConfirmed: Dispatch<SetStateAction<boolean>>;
    setStep: Dispatch<SetStateAction<number>>;
    setError: Dispatch<SetStateAction<string | null>>;
    setSavingSettings: Dispatch<SetStateAction<boolean>>;
  },
) {
  return Effect.gen(function* () {
    const result = yield* requestEffect(() =>
      api.updateStudioSettings({ models_dir: modelsDir.trim() }),
    );
    setSettings(result);
    setModelsDir(result.effective.models_dir);
    setHardwareConfirmed(false);
    setStep(1);
  }).pipe(
    Effect.catch((err) =>
      Effect.sync(() => setError(err instanceof Error ? err.message : "Failed to update settings")),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        setSavingSettings(false);
      }),
    ),
  );
}

export function runRuntimeJobEffect(
  payload: { backend: EngineBackend; targetId?: string; type: "install" | "update" },
  {
    setError,
    setRuntimeJobs,
    setDiagnostics,
    setUpgrading,
    refreshRuntimeState,
  }: {
    setError: Dispatch<SetStateAction<string | null>>;
    setRuntimeJobs: Dispatch<SetStateAction<EngineJob[]>>;
    setDiagnostics: Dispatch<SetStateAction<StudioDiagnostics | null>>;
    setUpgrading: Dispatch<SetStateAction<boolean>>;
    refreshRuntimeState: () => Promise<void>;
  },
) {
  return Effect.gen(function* () {
    const { job } = yield* requestEffect(() => api.createRuntimeJob(payload));
    setRuntimeJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
    const finalJob = yield* finishRuntimeJobEffect(job.id, setRuntimeJobs);
    if (finalJob.status === "error") {
      setError(describeFailedEngineJob(finalJob));
    }
    const refreshed = yield* requestEffect(() => api.getStudioDiagnostics());
    setDiagnostics(refreshed);
  }).pipe(
    Effect.catch((err) =>
      Effect.sync(() => setError(err instanceof Error ? err.message : "Runtime job failed")),
    ),
    Effect.ensuring(
      Effect.gen(function* () {
        yield* requestEffect(() => refreshRuntimeState()).pipe(Effect.catch(() => Effect.void));
        setUpgrading(false);
      }),
    ),
  );
}

export function beginDownloadEffect(
  modelId: string,
  preset: StarterPreset | undefined,
  {
    startDownload,
    setStep,
    setError,
  }: {
    startDownload: (params: {
      model_id: string;
      allow_patterns?: string[];
    }) => Promise<ModelDownload>;
    setStep: Dispatch<SetStateAction<number>>;
    setError: Dispatch<SetStateAction<string | null>>;
  },
) {
  return requestEffect(() =>
    startDownload({
      model_id: modelId,
      ...(preset?.allow_patterns?.length ? { allow_patterns: preset.allow_patterns } : {}),
    }),
  ).pipe(
    Effect.map(() => setStep(3)),
    Effect.catch((err) =>
      Effect.sync(() => setError(err instanceof Error ? err.message : "Failed to start download")),
    ),
  );
}

export function connectRemotePresetEffect(
  preset: StarterPreset,
  remote: NonNullable<StarterPreset["remote"]>,
  apiKey: string,
  {
    setRemoteError,
    setConnectingRemote,
    openAgentChat,
  }: {
    setRemoteError: Dispatch<SetStateAction<string | null>>;
    setConnectingRemote: Dispatch<SetStateAction<boolean>>;
    openAgentChat: () => void;
  },
) {
  return Effect.gen(function* () {
    const existing = yield* requestEffect(() => api.getProviders()).pipe(
      Effect.catch(() => Effect.succeed({ providers: [] })),
    );
    const alreadyThere = existing.providers.some((provider) => provider.id === preset.id);
    if (alreadyThere) {
      yield* requestEffect(() => api.updateProvider(preset.id, { api_key: apiKey, enabled: true }));
    } else {
      yield* requestEffect(() =>
        api.createProvider({
          id: preset.id,
          name: preset.name,
          base_url: remote.base_url,
          api_key: apiKey,
        }),
      );
    }
    markSetupComplete();
    openAgentChat();
  }).pipe(
    Effect.catch((err) =>
      Effect.sync(() =>
        setRemoteError(err instanceof Error ? err.message : "Failed to connect provider"),
      ),
    ),
    Effect.ensuring(Effect.sync(() => setConnectingRemote(false))),
  );
}

export function configureAndLaunchEffect(
  {
    activeDownload,
    selectedPreset,
    createdRecipeId,
  }: {
    activeDownload: ModelDownload;
    selectedPreset: StarterPreset | null;
    createdRecipeId: string | null;
  },
  {
    setRuntimeJobs,
    setCreatedRecipeId,
    setStep,
    setLaunchError,
    setConfiguringRecipe,
  }: {
    setRuntimeJobs: Dispatch<SetStateAction<EngineJob[]>>;
    setCreatedRecipeId: Dispatch<SetStateAction<string | null>>;
    setStep: Dispatch<SetStateAction<number>>;
    setLaunchError: Dispatch<SetStateAction<string | null>>;
    setConfiguringRecipe: Dispatch<SetStateAction<boolean>>;
  },
) {
  return Effect.gen(function* () {
    const backend = selectedPreset?.backend ?? "vllm";
    const targetPayload = yield* requestEffect(() => api.getRuntimeTargets()).pipe(
      Effect.catch(() => Effect.succeed({ targets: [] satisfies RuntimeTarget[] })),
    );
    const runtimeInstalled = targetPayload.targets.some((target) =>
      backend === "llamacpp"
        ? target.backend === backend && target.installed
        : isManagedServeRuntimeTarget(backend, target) && target.installed,
    );
    if (!runtimeInstalled) {
      const { job } = yield* requestEffect(() =>
        api.createRuntimeJob({ backend, type: "install" }),
      );
      setRuntimeJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
      const finalJob = yield* finishRuntimeJobEffect(job.id, setRuntimeJobs);
      if (finalJob.status === "error") {
        return yield* Effect.fail(new Error(describeFailedEngineJob(finalJob)));
      }
    }

    let recipeId = createdRecipeId;
    if (!recipeId) {
      const existing = yield* requestEffect(() => api.getRecipes()).pipe(
        Effect.catch(() => Effect.succeed({ recipes: [] })),
      );
      const recipe = buildStarterRecipe(activeDownload, existing.recipes, selectedPreset);
      yield* requestEffect(() => api.createRecipe(recipe));
      recipeId = recipe.id;
      setCreatedRecipeId(recipe.id);
    }

    yield* requestEffect(() => api.launch(recipeId));
    const ready = yield* requestEffect(() => api.waitReady(300));
    if (!ready.ready) {
      return yield* Effect.fail(
        new Error(ready.error || "The model did not become ready in time."),
      );
    }

    markSetupComplete();
    setStep(5);
  }).pipe(
    Effect.catch((err) =>
      Effect.sync(() =>
        setLaunchError(err instanceof Error ? err.message : "Failed to configure and launch"),
      ),
    ),
    Effect.ensuring(Effect.sync(() => setConfiguringRecipe(false))),
  );
}
