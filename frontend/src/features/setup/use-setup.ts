"use client";

import { Effect } from "effect";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  EngineBackend,
  EngineJob,
  ModelRecommendation,
  RuntimeTarget,
  StarterPreset,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  loadSecondarySetupDataEffect,
  loadSetupDataEffect,
  refreshRuntimeStateEffect,
  type SetupLoadSetters,
} from "./setup-load";
import {
  beginDownloadEffect,
  configureAndLaunchEffect,
  connectRemotePresetEffect,
  markSetupComplete,
  runRuntimeJobEffect,
  saveSettingsEffect,
} from "./setup-actions";
import { useSetupBenchmark } from "./use-setup-benchmark";

type ManagedSetupBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

export function useSetup() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [modelsDir, setModelsDir] = useState("");
  const [diagnostics, setDiagnostics] = useState<StudioDiagnostics | null>(null);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [presets, setPresets] = useState<StarterPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<StarterPreset | null>(null);
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [connectingRemote, setConnectingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [runtimeTargets, setRuntimeTargets] = useState<RuntimeTarget[]>([]);
  const [runtimeJobs, setRuntimeJobs] = useState<EngineJob[]>([]);
  const [maxVram, setMaxVram] = useState(0);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [manualModelId, setManualModelId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [hardwareConfirmed, setHardwareConfirmed] = useState(false);
  const [configuringRecipe, setConfiguringRecipe] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [createdRecipeId, setCreatedRecipeId] = useState<string | null>(null);

  const { benchmarking, benchmarkResult, benchmarkError, runSetupBenchmark, resetBenchmark } =
    useSetupBenchmark();

  const [lifecycle] = useState(() => ({ abort: new AbortController() }));
  useMountSubscription(() => {
    lifecycle.abort = new AbortController();
    return () => lifecycle.abort.abort();
  }, [lifecycle]);

  const downloadsState = useDownloads(2000);

  const activeDownload = useMemo(() => {
    if (!selectedModel) return null;
    return downloadsState.downloads.find((download) => download.model_id === selectedModel) ?? null;
  }, [downloadsState.downloads, selectedModel]);

  const refreshRuntimeState = useCallback(() => {
    return Effect.runPromise(refreshRuntimeStateEffect({ setRuntimeTargets, setRuntimeJobs }));
  }, []);

  const loadSecondarySetupData = useCallback(
    (initialWarnings: string[], loadSetters: SetupLoadSetters) => {
      return Effect.runPromise(loadSecondarySetupDataEffect(initialWarnings, loadSetters));
    },
    [],
  );

  const loadSetupData = useCallback(() => {
    const loadSetters: SetupLoadSetters = {
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
      setPresets,
    };
    return Effect.runPromise(
      loadSetupDataEffect(loadSetters, (warnings) => loadSecondarySetupData(warnings, loadSetters)),
    );
  }, [loadSecondarySetupData]);

  useMountSubscription(() => {
    void loadSetupData();
  }, [loadSetupData]);

  const saveSettings = useCallback(() => {
    if (!modelsDir.trim()) {
      setError("Models directory is required.");
      return Promise.resolve();
    }
    setSavingSettings(true);
    return Effect.runPromise(
      saveSettingsEffect(modelsDir, {
        setSettings,
        setModelsDir,
        setHardwareConfirmed,
        setStep,
        setError,
        setSavingSettings,
      }),
    );
  }, [modelsDir]);

  const runRuntimeJob = useCallback(
    (payload: { backend: EngineBackend; targetId?: string; type: "install" | "update" }) => {
      setUpgrading(true);
      setError(null);
      return Effect.runPromise(
        runRuntimeJobEffect(payload, {
          setError,
          setRuntimeJobs,
          setDiagnostics,
          setUpgrading,
          refreshRuntimeState,
        }),
        { signal: lifecycle.abort.signal },
      ).catch(() => undefined);
    },
    [lifecycle, refreshRuntimeState],
  );

  const installRuntime = useCallback(
    (backend: ManagedSetupBackend) => runRuntimeJob({ backend, type: "install" }),
    [runRuntimeJob],
  );

  const updateRuntimeTarget = useCallback(
    (target: RuntimeTarget) =>
      runRuntimeJob({
        backend: target.backend,
        targetId: target.id,
        type: target.installed ? "update" : "install",
      }),
    [runRuntimeJob],
  );

  const beginDownload = useCallback(
    (modelId: string, preset?: StarterPreset) => {
      if (!modelId) return Promise.resolve();
      setSelectedModel(modelId);
      setSelectedPreset(preset ?? null);
      setLaunchError(null);
      setCreatedRecipeId(null);
      resetBenchmark();
      return Effect.runPromise(
        beginDownloadEffect(modelId, preset, {
          startDownload: downloadsState.startDownload,
          setStep,
          setError,
        }),
      );
    },
    [downloadsState, resetBenchmark],
  );

  const beginPresetSetup = useCallback(
    (preset: StarterPreset) => {
      if (preset.kind === "download" && preset.model_id) {
        return beginDownload(preset.model_id, preset);
      }
      return Promise.resolve();
    },
    [beginDownload],
  );

  const connectRemotePreset = useCallback(
    (preset: StarterPreset) => {
      const remote = preset.remote;
      if (preset.kind !== "remote" || !remote) return Promise.resolve();
      const apiKey = remoteApiKey.trim();
      if (!apiKey) {
        setRemoteError("An API key is required to connect.");
        return Promise.resolve();
      }
      setConnectingRemote(true);
      setRemoteError(null);
      return Effect.runPromise(
        connectRemotePresetEffect(preset, remote, apiKey, {
          setRemoteError,
          setConnectingRemote,
          openAgentChat: () => router.push("/agent?new=1"),
        }),
      );
    },
    [remoteApiKey, router],
  );

  const submitManualModel = useCallback(() => {
    const trimmed = manualModelId.trim();
    if (!trimmed) return Promise.resolve();
    return beginDownload(trimmed);
  }, [manualModelId, beginDownload]);
  const continueFromHardware = useCallback(() => {
    if (!hardwareConfirmed) return;
    setStep(2);
  }, [hardwareConfirmed]);

  const configureAndLaunch = useCallback(() => {
    if (!activeDownload || activeDownload.status !== "completed") {
      return Promise.resolve();
    }

    setConfiguringRecipe(true);
    setLaunchError(null);
    resetBenchmark();

    return Effect.runPromise(
      configureAndLaunchEffect(
        { activeDownload, selectedPreset, createdRecipeId },
        { setRuntimeJobs, setCreatedRecipeId, setStep, setLaunchError, setConfiguringRecipe },
      ),
    );
  }, [activeDownload, createdRecipeId, resetBenchmark, selectedPreset, setRuntimeJobs]);

  const openChat = useCallback(() => {
    markSetupComplete();
    router.push("/agent?new=1");
  }, [router]);

  const openDashboard = useCallback(() => {
    markSetupComplete();
    router.push("/");
  }, [router]);

  const skipSetup = useCallback(() => {
    markSetupComplete();
    router.push("/");
  }, [router]);

  return {
    step,
    setStep,
    loading,
    error,
    loadWarning,
    settings,
    modelsDir,
    setModelsDir,
    diagnostics,
    recommendations,
    presets,
    selectedPreset,
    beginPresetSetup,
    remoteApiKey,
    setRemoteApiKey,
    connectingRemote,
    remoteError,
    connectRemotePreset,
    runtimeTargets,
    runtimeJobs,
    maxVram,
    selectedModel,
    manualModelId,
    setManualModelId,
    savingSettings,
    upgrading,
    hardwareConfirmed,
    setHardwareConfirmed,
    downloads: downloadsState.downloads,
    activeDownload,
    pauseDownload: downloadsState.pauseDownload,
    resumeDownload: downloadsState.resumeDownload,
    cancelDownload: downloadsState.cancelDownload,
    saveSettings,
    installRuntime,
    updateRuntimeTarget,
    beginDownload,
    submitManualModel,
    continueFromHardware,
    configuringRecipe,
    launchError,
    createdRecipeId,
    configureAndLaunch,
    benchmarking,
    benchmarkResult,
    benchmarkError,
    runSetupBenchmark,
    openChat,
    openDashboard,
    skipSetup,
  };
}
