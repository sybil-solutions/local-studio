import { Effect } from "effect";
import { useCallback, useState } from "react";
import api from "@/lib/api/client";
import { requestEffect } from "./use-setup-effects";

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

export function useSetupBenchmark() {
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<SetupBenchmarkResult | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const runSetupBenchmark = useCallback(() => {
    setBenchmarking(true);
    setBenchmarkError(null);
    setBenchmarkResult(null);
    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* requestEffect(() => api.runBenchmark(1000));
        if (result.error) {
          return yield* Effect.fail(new Error(result.error));
        }
        if (!result.benchmark) {
          return yield* Effect.fail(new Error("Benchmark returned no metrics."));
        }

        setBenchmarkResult({
          prompt_tokens: result.benchmark.prompt_tokens,
          completion_tokens: result.benchmark.completion_tokens,
          total_time_s: result.benchmark.total_time_s,
          generation_tps: result.benchmark.generation_tps,
        });
      }).pipe(
        Effect.catch((err) =>
          Effect.sync(() =>
            setBenchmarkError(err instanceof Error ? err.message : "Benchmark failed"),
          ),
        ),
        Effect.ensuring(Effect.sync(() => setBenchmarking(false))),
      ),
    );
  }, []);

  const resetBenchmark = useCallback(() => {
    setBenchmarkResult(null);
    setBenchmarkError(null);
  }, []);

  return { benchmarking, benchmarkResult, benchmarkError, runSetupBenchmark, resetBenchmark };
}
