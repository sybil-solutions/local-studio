import { useState } from "react";
import api from "@/lib/api/client";

export function useDashboardActions() {
  const [benchmarking, setBenchmarking] = useState(false);

  const onBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const result = await api.runBenchmark(1000);
      if (result.error) alert("Benchmark error: " + result.error);
    } catch (e) {
      alert("Benchmark failed: " + (e as Error).message);
    } finally {
      setBenchmarking(false);
    }
  };

  return { benchmarking, onBenchmark };
}
