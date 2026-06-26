"use client";

import { AlertTriangle, Loader2 } from "@/ui/icon-registry";
import { Alert, AppPage, Button, Card } from "@/ui";
import type { ManagedRuntimeInstallBackend } from "@/features/settings/runtime-targets";
import type {
  EngineJob,
  ModelDownload,
  ModelRecommendation,
  RuntimeTarget,
  StudioDiagnostics,
  StudioSettings,
} from "@/lib/types";
import { SetupStepper } from "./setup-stepper";
import { StepBenchmark } from "./step-benchmark";
import { StepDownload } from "./step-download";
import { StepHardware } from "./step-hardware";
import { StepLaunch } from "./step-launch";
import { StepModel } from "./step-model";
import { StepWelcome } from "./step-welcome";

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
  loadWarning: string | null;
  settings: StudioSettings | null;
  modelsDir: string;
  setModelsDir: (value: string) => void;
  diagnostics: StudioDiagnostics | null;
  recommendations: ModelRecommendation[];
  runtimeTargets: RuntimeTarget[];
  runtimeJobs: EngineJob[];
  maxVram: number;
  selectedModel: string;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  savingSettings: boolean;
  upgrading: boolean;
  hardwareConfirmed: boolean;
  setHardwareConfirmed: (value: boolean) => void;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  saveSettings: () => void;
  installRuntime: (backend: ManagedRuntimeInstallBackend) => void;
  updateRuntimeTarget: (target: RuntimeTarget) => void;
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
  loadWarning,
  settings,
  modelsDir,
  setModelsDir,
  diagnostics,
  recommendations,
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
  downloads,
  activeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
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
}: SetupViewProps) {
  return (
    <AppPage className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-sm text-(--dim) uppercase tracking-wider">Setup Wizard</div>
            <h1 className="text-2xl font-semibold">Local Studio Desktop</h1>
          </div>
          <Button variant="secondary" size="sm" onClick={skipSetup}>
            Skip for now
          </Button>
        </div>

        <div className="flex items-center gap-3 mb-8">
          <SetupStepper step={step} />
        </div>

        {loading && (
          <Card padding="lg" className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-(--dim)" />
            <span className="text-sm text-(--dim)">Preparing your setup...</span>
          </Card>
        )}

        {error && (
          <Alert variant="error" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
            <SetupErrorBody error={error} />
          </Alert>
        )}

        {loadWarning && !error && (
          <Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
            {loadWarning}
          </Alert>
        )}

        {!loading && step === 0 && (
          <StepWelcome
            modelsDir={modelsDir}
            setModelsDir={setModelsDir}
            settings={settings}
            diagnostics={diagnostics}
            saveSettings={saveSettings}
            savingSettings={savingSettings}
          />
        )}

        {!loading && step === 1 && (
          <StepHardware
            diagnostics={diagnostics}
            runtimeTargets={runtimeTargets}
            runtimeJobs={runtimeJobs}
            installRuntime={installRuntime}
            updateRuntimeTarget={updateRuntimeTarget}
            upgrading={upgrading}
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
    </AppPage>
  );
}

/** Failed runtime jobs report a headline plus a multi-line command-output tail. */
function SetupErrorBody({ error }: { error: string }) {
  const [headline, ...rest] = error.split("\n");
  const detail = rest.join("\n").trim();
  return (
    <>
      <p className="break-words">{headline}</p>
      {detail ? (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono text-xs opacity-90">
          {detail}
        </pre>
      ) : null}
    </>
  );
}
