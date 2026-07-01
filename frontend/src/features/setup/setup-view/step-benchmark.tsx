"use client";

import { Activity, LayoutDashboard, Loader2, MessageCircle } from "@/ui/icon-registry";
import { Alert, Button, Card } from "@/ui";
import { FactGrid } from "@/features/setup/fact-grid";

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

export function StepBenchmark({
  benchmarking,
  benchmarkResult,
  benchmarkError,
  runSetupBenchmark,
  openChat,
  openDashboard,
}: {
  benchmarking: boolean;
  benchmarkResult: SetupBenchmarkResult | null;
  benchmarkError: string | null;
  runSetupBenchmark: () => void;
  openChat: () => void;
  openDashboard: () => void;
}) {
  const hasAttemptedBenchmark = Boolean(benchmarkResult || benchmarkError);

  return (
    <div className="space-y-6">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Benchmark the Running Model</h2>
        </div>
        <p className="text-sm text-(--dim)">
          The model is ready. Run one explicit benchmark pass to confirm the device can serve real
          traffic before you drop into chat.
        </p>
        <Button
          onClick={runSetupBenchmark}
          disabled={benchmarking}
          icon={
            benchmarking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )
          }
        >
          {benchmarking ? "Benchmarking..." : "Run Benchmark"}
        </Button>

        {benchmarkResult && (
          <Alert variant="success">
            <div className="space-y-3">
              <div>Benchmark completed.</div>
              <FactGrid
                columns={4}
                items={[
                  { label: "Prompt tokens", value: benchmarkResult.prompt_tokens },
                  { label: "Completion tokens", value: benchmarkResult.completion_tokens },
                  { label: "Total time", value: `${benchmarkResult.total_time_s}s` },
                  { label: "Generation TPS", value: benchmarkResult.generation_tps },
                ]}
              />
            </div>
          </Alert>
        )}

        {benchmarkError && <Alert variant="error">{benchmarkError}</Alert>}
      </Card>

      {hasAttemptedBenchmark && (
        <Card padding="lg" className="flex flex-wrap items-center gap-3">
          <Button onClick={openChat} icon={<MessageCircle className="h-4 w-4" />}>
            Open Chat
          </Button>
          <Button
            variant="secondary"
            onClick={openDashboard}
            icon={<LayoutDashboard className="h-4 w-4" />}
          >
            Open Dashboard
          </Button>
        </Card>
      )}
    </div>
  );
}
