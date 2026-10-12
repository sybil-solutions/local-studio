import { useCallback, useRef, useState } from "react";
import type { HuggingFaceModelCardPayload } from "@/lib/huggingface";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useModelCardPayload(modelId: string, open: boolean) {
  const [payload, setPayload] = useState<HuggingFaceModelCardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow response for a previous modelId landing after the
  // card switched to a different model.
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!modelId) return;
    const requestId = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/huggingface/model-card?modelId=${encodeURIComponent(modelId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as HuggingFaceModelCardPayload & { error?: string };
      if (requestId !== requestSeqRef.current) return;
      if (!response.ok) throw new Error(data.error || "Unable to load model card.");
      setPayload(data);
    } catch (loadError) {
      if (requestId !== requestSeqRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load model card.");
      setPayload(null);
    } finally {
      if (requestId === requestSeqRef.current) setLoading(false);
    }
  }, [modelId]);

  useMountSubscription(() => {
    if (open && modelId) void load();
  }, [load, modelId, open]);

  return { error, loading, payload };
}
