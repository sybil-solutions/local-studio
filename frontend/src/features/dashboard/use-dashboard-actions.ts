import { useState } from "react";
import api from "@/lib/api/client";

export function useDashboardActions(modelKey: string | null) {
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<{
    modelKey: string | null;
    generationTps: number;
  } | null>(null);

  const onBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const result = await api.runBenchmark(1000);
      if (result.error) {
        alert("Benchmark error: " + result.error);
      } else if (result.benchmark) {
        setBenchmarkResult({ modelKey, generationTps: result.benchmark.generation_tps });
      } else {
        alert("Benchmark failed: The controller returned no result");
      }
    } catch (e) {
      alert("Benchmark failed: " + (e as Error).message);
    } finally {
      setBenchmarking(false);
    }
  };

  return {
    benchmarking,
    benchmarkResult: benchmarkResult?.modelKey === modelKey ? benchmarkResult.generationTps : null,
    onBenchmark,
  };
}
