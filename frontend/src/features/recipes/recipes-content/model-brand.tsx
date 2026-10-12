"use client";

import { ExternalLink } from "@/ui/icon-registry";
import type { ModelIndexModel, ModelIndexVariant } from "@/lib/api/studio";
import { FORMAT_LABELS, formatGb, type Fit } from "./model-fit";

/**
 * Publisher identity and Hugging Face affordances for a catalog model.
 *
 * This file was named `model-catalog-card` when the Models page rendered cards.
 * The cards are gone — the page is a table now — and nothing here draws a card,
 * so the name follows what the module actually is.
 */
type ModelBrand = { owner: string; label: string; color: string; repo: string };

const BRANDS: Record<string, { label: string; color: string }> = {
  qwen: { label: "Qwen", color: "#5B7CFA" },
  google: { label: "Google", color: "#4285F4" },
  "stepfun-ai": { label: "StepFun", color: "#4E9C81" },
  "deepseek-ai": { label: "DeepSeek", color: "#4D6BFE" },
  tencent: { label: "Tencent", color: "#2A7DE1" },
  minimaxai: { label: "MiniMax", color: "#D36E4D" },
  "zai-org": { label: "Z.ai", color: "#68728A" },
  liquidai: { label: "Liquid AI", color: "#12B5A5" },
  "motif-technologies": { label: "Motif", color: "#1783FF" },
  nvidia: { label: "NVIDIA", color: "#76B900" },
};

export function modelBrand(model: ModelIndexModel): ModelBrand {
  const variant = model.variants.find((candidate) => candidate.official) ?? model.variants[0];
  const repo = variant?.repo ?? model.id;
  const owner = repo.split("/")[0]?.trim() || model.id;
  const brand = BRANDS[owner.toLowerCase()];
  return {
    owner,
    label: brand?.label ?? owner,
    color: brand?.color ?? "#64748B",
    repo,
  };
}

function hubUrl(repo: string): string {
  return `https://huggingface.co/${repo}`;
}

export function HubLink({ repo, label }: { repo: string; label?: string }) {
  return (
    <a
      href={hubUrl(repo)}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      title={`Open ${repo} on Hugging Face`}
      aria-label={`Open ${repo} on Hugging Face`}
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
    >
      <HuggingFaceMark className="h-3.5 w-3.5" />
      {label ? <span>{label}</span> : null}
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}

/** The Hugging Face mark, inlined so the row never waits on a network image. */
function HuggingFaceMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <circle cx="16" cy="17.5" r="12.5" fill="#FFD21E" />
      <path
        fill="#FF9D0B"
        d="M16 5a12.5 12.5 0 1 0 0 25 12.5 12.5 0 0 0 0-25Zm0 2.2a10.3 10.3 0 1 1 0 20.6 10.3 10.3 0 0 1 0-20.6Z"
      />
      <circle cx="11.6" cy="15.6" r="1.8" fill="#3A3B45" />
      <circle cx="20.4" cy="15.6" r="1.8" fill="#3A3B45" />
      <path
        fill="#3A3B45"
        d="M16 25.1c-3.2 0-5.4-2.2-5.4-4 0-.8.7-1.2 1.5-.8 1 .5 2.3.8 3.9.8s2.9-.3 3.9-.8c.8-.4 1.5 0 1.5.8 0 1.8-2.2 4-5.4 4Z"
      />
    </svg>
  );
}

/** Plain-language answer to "can I run this?" — the sizes live in the spec row. */
export function FitVerdict({
  fit,
  variant,
  poolGb,
}: {
  fit: Fit;
  variant: ModelIndexVariant | null;
  poolGb: number;
}) {
  if (poolGb <= 0) return <>Detect your GPUs to check hardware fit</>;
  if (fit.state === "unknown" || !variant) return <>Weights size unknown — check the repo</>;
  const format = FORMAT_LABELS[variant.format];
  if (fit.state === "fits") return <>Runs on this machine at {format}</>;
  if (fit.state === "tight") {
    return <>Tight at {format} — no room left for the KV cache</>;
  }
  return (
    <>
      Too large — needs {formatGb(fit.sizeGb)} of {Math.round(poolGb)} GB
    </>
  );
}
