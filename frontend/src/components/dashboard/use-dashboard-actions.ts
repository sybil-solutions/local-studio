import { useState } from "react";
import api from "@/lib/api";

export function useDashboardActions(reload: () => Promise<void>) {
  const [launching, setLaunching] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);

  const onLaunch = async (recipeId: string) => {
    setLaunching(true);
    try {
      await api.switchModel(recipeId, true);
    } catch (e) {
      alert("Failed to launch: " + (e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const onStop = async () => {
    if (!confirm("Stop the current model?")) return;
    try {
      await api.evictModel(true);
      await reload();
    } catch (e) {
      alert("Failed to stop: " + (e as Error).message);
    }
  };

  const onBenchmark = async () => {
    if (benchmarking) return;
    setBenchmarking(true);
    try {
      const result = await api.runBenchmark(1000, 100);
      if (result.error) alert("Benchmark error: " + result.error);
    } catch (e) {
      alert("Benchmark failed: " + (e as Error).message);
    } finally {
      setBenchmarking(false);
    }
  };

  return { launching, benchmarking, onLaunch, onStop, onBenchmark };
}
