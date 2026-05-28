"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import type {
  ModelDownload,
  ModelRecommendation,
  StudioDiagnostics,
  StudioSettings,
  VllmUpgradeResult,
} from "@/lib/types";
import { SetupStepper } from "./setup-view/setup-stepper";
import { StepBenchmark } from "./setup-view/step-benchmark";
import { StepDownload } from "./setup-view/step-download";
import { StepHardware } from "./setup-view/step-hardware";
import { StepLaunch } from "./setup-view/step-launch";
import { StepModel } from "./setup-view/step-model";
import { StepWelcome } from "./setup-view/step-welcome";

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

interface SetupViewProps {
  step: number;
  setStep: (step: number) => void;
  loading: boolean;
  error: string | null;
  settings: StudioSettings | null;
  modelsDir: string;
  setModelsDir: (value: string) => void;
  diagnostics: StudioDiagnostics | null;
  recommendations: ModelRecommendation[];
  maxVram: number;
  selectedModel: string;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  savingSettings: boolean;
  upgrading: boolean;
  upgradeResult: VllmUpgradeResult | null;
  hardwareConfirmed: boolean;
  setHardwareConfirmed: (value: boolean) => void;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  saveSettings: () => void;
  upgradeRuntime: () => void;
  beginDownload: (modelId: string) => void;
  submitManualModel: () => void;
  continueFromHardware: () => void;
  configuringRecipe: boolean;
  launchError: string | null;
  createdRecipeId: string | null;
  configureAndLaunch: () => void;
  benchmarking: boolean;
  benchmarkResult: SetupBenchmarkResult | null;
  benchmarkError: string | null;
  runSetupBenchmark: () => void;
  openChat: () => void;
  openDashboard: () => void;
  skipSetup: () => void;
}

export function SetupView({
  step,
  setStep,
  loading,
  error,
  settings,
  modelsDir,
  setModelsDir,
  diagnostics,
  recommendations,
  maxVram,
  selectedModel,
  manualModelId,
  setManualModelId,
  savingSettings,
  upgrading,
  upgradeResult,
  hardwareConfirmed,
  setHardwareConfirmed,
  downloads,
  activeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  saveSettings,
  upgradeRuntime,
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
}: SetupViewProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-(--bg) via-(--bg) to-(--surface) text-(--fg)">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-sm text-(--dim) uppercase tracking-wider">Setup Wizard</div>
            <h1 className="text-2xl font-semibold">vLLM Studio Desktop</h1>
          </div>
          <button
            onClick={skipSetup}
            className="px-3 py-1.5 text-xs text-(--dim) border border-(--surface) rounded-lg hover:text-(--fg) hover:border-(--border)"
          >
            Skip for now
          </button>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <SetupStepper step={step} />
        </div>

        {loading && (
          <div className="bg-(--bg) border border-(--surface) rounded-lg p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-(--dim)" />
            <span className="text-sm text-(--dim)">Preparing your setup...</span>
          </div>
        )}

        {error && (
          <div className="bg-(--err)/10 border border-(--err)/30 rounded-lg p-4 mb-6 text-sm text-(--err) flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!loading && step === 0 && (
          <StepWelcome
            modelsDir={modelsDir}
            setModelsDir={setModelsDir}
            settings={settings}
            saveSettings={saveSettings}
            savingSettings={savingSettings}
          />
        )}

        {!loading && step === 1 && (
          <StepHardware
            diagnostics={diagnostics}
            upgradeRuntime={upgradeRuntime}
            upgrading={upgrading}
            upgradeResult={upgradeResult}
            hardwareConfirmed={hardwareConfirmed}
            setHardwareConfirmed={setHardwareConfirmed}
            continueFromHardware={continueFromHardware}
          />
        )}

        {!loading && step === 2 && (
          <StepModel
            recommendations={recommendations}
            maxVram={maxVram}
            manualModelId={manualModelId}
            setManualModelId={setManualModelId}
            beginDownload={beginDownload}
            submitManualModel={submitManualModel}
            setStep={setStep}
          />
        )}

        {!loading && step === 3 && (
          <StepDownload
            selectedModel={selectedModel}
            modelsDir={modelsDir}
            downloads={downloads}
            activeDownload={activeDownload}
            pauseDownload={pauseDownload}
            resumeDownload={resumeDownload}
            cancelDownload={cancelDownload}
            continueToLaunch={() => setStep(4)}
          />
        )}

        {!loading && step === 4 && (
          <StepLaunch
            selectedModel={selectedModel}
            createdRecipeId={createdRecipeId}
            configuringRecipe={configuringRecipe}
            launchError={launchError}
            configureAndLaunch={configureAndLaunch}
          />
        )}

        {!loading && step === 5 && (
          <StepBenchmark
            benchmarking={benchmarking}
            benchmarkResult={benchmarkResult}
            benchmarkError={benchmarkError}
            runSetupBenchmark={runSetupBenchmark}
            openChat={openChat}
            openDashboard={openDashboard}
          />
        )}
      </div>
    </div>
  );
}
