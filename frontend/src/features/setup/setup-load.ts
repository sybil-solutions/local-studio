import { Effect, Result } from "effect";
import type { Dispatch, SetStateAction } from "react";
import api from "@/lib/api/client";
import type {
  EngineJob,
  ModelRecommendation,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import {
  CONTROLLER_UNREACHABLE_MESSAGE,
  formatLoadWarning,
  requestEffect,
  setupErrorMessage,
  withSetupTimeoutEffect,
} from "./use-setup-effects";

type RuntimeStateSetters = {
  setRuntimeTargets: Dispatch<SetStateAction<RuntimeTarget[]>>;
  setRuntimeJobs: Dispatch<SetStateAction<EngineJob[]>>;
};

export type SetupLoadSetters = RuntimeStateSetters & {
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setLoadWarning: Dispatch<SetStateAction<string | null>>;
  setSettings: Dispatch<SetStateAction<StudioSettings | null>>;
  setModelsDir: Dispatch<SetStateAction<string>>;
  setDiagnostics: Dispatch<SetStateAction<StudioDiagnostics | null>>;
  setRecommendations: Dispatch<SetStateAction<ModelRecommendation[]>>;
  setMaxVram: Dispatch<SetStateAction<number>>;
  setPresets: Dispatch<SetStateAction<StarterPreset[]>>;
};

export function refreshRuntimeStateEffect({
  setRuntimeTargets,
  setRuntimeJobs,
}: RuntimeStateSetters) {
  return Effect.gen(function* () {
    const [targetPayload, jobPayload] = yield* Effect.all([
      requestEffect(() => api.getRuntimeTargets()).pipe(
        Effect.catch(() => Effect.succeed({ targets: [] })),
      ),
      requestEffect(() => api.getRuntimeJobs()).pipe(
        Effect.catch(() => Effect.succeed({ jobs: [] })),
      ),
    ] as const);
    setRuntimeTargets(targetPayload.targets);
    setRuntimeJobs(jobPayload.jobs);
  });
}

export function loadSecondarySetupDataEffect(
  initialWarnings: string[],
  {
    setPresets,
    setRecommendations,
    setMaxVram,
    setRuntimeTargets,
    setRuntimeJobs,
    setLoadWarning,
  }: SetupLoadSetters,
) {
  return Effect.gen(function* () {
    const warnings = [...initialWarnings];
    const [recommendationsResult, presetsResult, targetResult, jobResult] = yield* Effect.all([
      Effect.result(withSetupTimeoutEffect(api.getModelRecommendations(), "model recommendations")),
      Effect.result(withSetupTimeoutEffect(api.getStarterPresets(), "starter presets")),
      Effect.result(withSetupTimeoutEffect(api.getRuntimeTargets(), "runtime targets")),
      Effect.result(withSetupTimeoutEffect(api.getRuntimeJobs(), "runtime jobs")),
    ] as const);

    if (Result.isSuccess(presetsResult)) {
      setPresets(presetsResult.success.presets || []);
    } else setPresets([]);

    if (Result.isSuccess(recommendationsResult)) {
      setRecommendations(recommendationsResult.success.recommendations || []);
      setMaxVram(recommendationsResult.success.max_vram_gb ?? 0);
    } else {
      setRecommendations([]);
      setMaxVram(0);
      warnings.push(`model recommendations: ${setupErrorMessage(recommendationsResult.failure)}`);
    }

    if (Result.isSuccess(targetResult)) {
      setRuntimeTargets(targetResult.success.targets);
    } else {
      setRuntimeTargets([]);
      warnings.push(`runtime targets: ${setupErrorMessage(targetResult.failure)}`);
    }

    if (Result.isSuccess(jobResult)) {
      setRuntimeJobs(jobResult.success.jobs);
    } else {
      setRuntimeJobs([]);
      warnings.push(`runtime jobs: ${setupErrorMessage(jobResult.failure)}`);
    }

    setLoadWarning(formatLoadWarning(warnings));
  });
}

export function loadSetupDataEffect(
  {
    setLoading,
    setError,
    setLoadWarning,
    setSettings,
    setModelsDir,
    setDiagnostics,
    setRecommendations,
    setMaxVram,
    setRuntimeTargets,
    setRuntimeJobs,
  }: SetupLoadSetters,
  loadSecondarySetupData: (initialWarnings: string[]) => Promise<void>,
) {
  return Effect.gen(function* () {
    setLoading(true);
    setError(null);
    setLoadWarning(null);
    const warnings: string[] = [];
    const [settingsResult, diagnosticsResult] = yield* Effect.all([
      Effect.result(withSetupTimeoutEffect(api.getStudioSettings(), "settings")),
      Effect.result(withSetupTimeoutEffect(api.getStudioDiagnostics(), "controller diagnostics")),
    ] as const);

    if (Result.isSuccess(settingsResult)) {
      setSettings(settingsResult.success);
      setModelsDir(settingsResult.success.effective.models_dir);
    } else {
      setSettings(null);
      warnings.push(`settings: ${setupErrorMessage(settingsResult.failure)}`);
    }

    if (Result.isSuccess(diagnosticsResult)) {
      setDiagnostics(diagnosticsResult.success);
      if (Result.isFailure(settingsResult)) {
        setModelsDir(diagnosticsResult.success.config.models_dir || "");
      }
    } else {
      setDiagnostics(null);
      warnings.push(`controller diagnostics: ${setupErrorMessage(diagnosticsResult.failure)}`);
    }

    if (Result.isFailure(settingsResult) && Result.isFailure(diagnosticsResult)) {
      setError(CONTROLLER_UNREACHABLE_MESSAGE);
      return;
    }

    setRecommendations([]);
    setMaxVram(0);
    setRuntimeTargets([]);
    setRuntimeJobs([]);
    setLoadWarning(formatLoadWarning(warnings));

    void loadSecondarySetupData(warnings);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        setLoading(false);
      }),
    ),
  );
}
