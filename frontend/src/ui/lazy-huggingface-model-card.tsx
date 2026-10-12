"use client";

import { useState, type ComponentType } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { HuggingFaceModelCardPanelProps } from "./huggingface-model-card";

type ModelCardComponent = ComponentType<HuggingFaceModelCardPanelProps>;

let modelCardPromise: Promise<ModelCardComponent> | null = null;

function loadModelCard(): Promise<ModelCardComponent> {
  modelCardPromise ??= import("./huggingface-model-card").then(
    (mod) => mod.HuggingFaceModelCardPanel,
  );
  return modelCardPromise;
}

export function LazyHuggingFaceModelCardPanel(props: HuggingFaceModelCardPanelProps) {
  const [ModelCardPanel, setModelCardPanel] = useState<ModelCardComponent | null>(null);

  useMountSubscription(() => {
    if (!props.open || ModelCardPanel) return;
    let cancelled = false;
    void loadModelCard().then((Component) => {
      if (!cancelled) setModelCardPanel(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [ModelCardPanel, props.open]);

  if (!props.open || !ModelCardPanel) return null;
  return <ModelCardPanel {...props} />;
}
