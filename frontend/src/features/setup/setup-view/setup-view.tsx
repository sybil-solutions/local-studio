"use client";

import { AlertTriangle } from "@/ui/icon-registry";
import { Alert, AppPage, Button, Card, PageContainer, PageHeader, Spinner } from "@/ui";
import type { ManagedRuntimeInstallBackend } from "@/features/settings/runtime-targets";
import type {
  EngineJob,
  ModelDownload,
  ModelRecommendation,
  RuntimeTarget,
  StarterPreset,
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
import type { GgufFileOption } from "../setup-model-files";

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
  presets: StarterPreset[];
  selectedPreset: StarterPreset | null;
  beginPresetSetup: (preset: StarterPreset) => void;
  remoteApiKey: string;
  setRemoteApiKey: (value: string) => void;
  connectingRemote: boolean;
  remoteError: string | null;
  connectRemotePreset: (preset: StarterPreset) => void;
  runtimeTargets: RuntimeTarget[];
  runtimeJobs: EngineJob[];
  maxVram: number;
  selectedModel: string;
  manualModelId: string;
  setManualModelId: (value: string) => void;
  manualGgufOptions: GgufFileOption[];
  manualGgufFile: string;
  setManualGgufFile: (value: string) => void;
  resolvingManualModel: boolean;
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
  manualGgufOptions,
  manualGgufFile,
  setManualGgufFile,
  resolvingManualModel,
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
      <PageContainer width="lg">
        <PageHeader
          eyebrow="Local Studio onboarding"
          title="Build your local AI station"
          description="One guided path from controller hardware to a verified Serve and working agent."
          actions={
            <Button variant="secondary" size="sm" onClick={skipSetup}>
              Skip for now
            </Button>
          }
        />
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <SetupStepper step={step} />
          <div className="min-w-0">
            {loading ? (
              <Card padding="lg" className="flex items-center gap-3">
                <Spinner size="lg" className="text-(--dim)" />
                <span className="text-sm text-(--dim)">Inspecting the active controller…</span>
              </Card>
            ) : null}

            {error ? (
              <Alert variant="error" icon={<AlertTriangle className="h-4 w-4" />} className="mb-6">
                <SetupErrorBody error={error} />
              </Alert>
            ) : null}

            {loadWarning && !error ? (
              <Alert
                variant="warning"
                icon={<AlertTriangle className="h-4 w-4" />}
                className="mb-6"
              >
                {loadWarning}
              </Alert>
            ) : null}

            {!loading && step === 0 ? (
              <StepWelcome
                modelsDir={modelsDir}
                setModelsDir={setModelsDir}
                settings={settings}
                diagnostics={diagnostics}
                saveSettings={saveSettings}
                savingSettings={savingSettings}
              />
            ) : null}

            {!loading && step === 1 ? (
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
            ) : null}

            {!loading && step === 2 ? (
              <StepModel
                recommendations={recommendations}
                presets={presets}
                beginPresetSetup={beginPresetSetup}
                remoteApiKey={remoteApiKey}
                setRemoteApiKey={setRemoteApiKey}
                connectingRemote={connectingRemote}
                remoteError={remoteError}
                connectRemotePreset={connectRemotePreset}
                maxVram={maxVram}
                manualModelId={manualModelId}
                setManualModelId={setManualModelId}
                manualGgufOptions={manualGgufOptions}
                manualGgufFile={manualGgufFile}
                setManualGgufFile={setManualGgufFile}
                resolvingManualModel={resolvingManualModel}
                beginDownload={beginDownload}
                submitManualModel={submitManualModel}
                setStep={setStep}
              />
            ) : null}

            {!loading && step === 3 ? (
              <StepDownload
                selectedModel={selectedModel}
                modelsDir={modelsDir}
                downloads={downloads}
                activeDownload={activeDownload}
                pauseDownload={pauseDownload}
                resumeDownload={resumeDownload}
                cancelDownload={cancelDownload}
                continueToLaunch={() => setStep(4)}
                backToModels={() => setStep(2)}
              />
            ) : null}

            {!loading && step === 4 ? (
              <StepLaunch
                backend={selectedPreset?.backend ?? "vllm"}
                selectedModel={selectedModel}
                createdRecipeId={createdRecipeId}
                configuringRecipe={configuringRecipe}
                launchError={launchError}
                configureAndLaunch={configureAndLaunch}
              />
            ) : null}

            {!loading && step === 5 ? (
              <StepBenchmark
                benchmarking={benchmarking}
                benchmarkResult={benchmarkResult}
                benchmarkError={benchmarkError}
                runSetupBenchmark={runSetupBenchmark}
                openChat={openChat}
                openDashboard={openDashboard}
              />
            ) : null}
          </div>
        </div>
      </PageContainer>
    </AppPage>
  );
}

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
