"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  MessageCircle,
} from "lucide-react";
import { Button, Card } from "@/ui";

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
          <div className="space-y-3 rounded-lg border border-(--hl2)/30 bg-(--hl2)/10 p-4">
            <div className="flex items-center gap-2 text-sm text-(--hl2)">
              <CheckCircle2 className="h-4 w-4" />
              Benchmark completed.
            </div>
            <div className="grid gap-3 md:grid-cols-4 text-sm">
              <div>
                <div className="text-xs text-(--dim)">Prompt tokens</div>
                <div>{benchmarkResult.prompt_tokens}</div>
              </div>
              <div>
                <div className="text-xs text-(--dim)">Completion tokens</div>
                <div>{benchmarkResult.completion_tokens}</div>
              </div>
              <div>
                <div className="text-xs text-(--dim)">Total time</div>
                <div>{benchmarkResult.total_time_s}s</div>
              </div>
              <div>
                <div className="text-xs text-(--dim)">Generation TPS</div>
                <div>{benchmarkResult.generation_tps}</div>
              </div>
            </div>
          </div>
        )}

        {benchmarkError && (
          <div className="flex items-start gap-2 rounded-lg border border-(--err)/30 bg-(--err)/10 p-3 text-sm text-(--err)">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{benchmarkError}</span>
          </div>
        )}
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
