"use client";

import { useState } from "react";
import { hfAvatarUrl } from "@/lib/huggingface";
import { bundledLogoUrl } from "./model-logo-bundled";
import { cx } from "./utils";

const PALETTE = [
  "bg-sky-500/12 text-sky-300 border-sky-500/20",
  "bg-teal-400/12 text-teal-300 border-teal-400/20",
  "bg-violet-400/12 text-violet-300 border-violet-400/20",
  "bg-amber-400/12 text-amber-300 border-amber-400/20",
  "bg-emerald-400/12 text-emerald-400 border-emerald-400/20",
  "bg-slate-500/12 text-slate-300 border-slate-500/20",
];

const hashString = (value: string): number =>
  Array.from(value).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);

const cleanPart = (part: string): string => part.replace(/[^a-z0-9]/gi, "").trim();

const modelNamePart = (modelId: string): string => {
  const parts = modelId.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? modelId;
};

const initialsFor = (modelId: string, author?: string | null, label?: string): string => {
  const source = label || modelNamePart(modelId);
  const sourceParts = source
    .split(/[-_\s.]+/)
    .map(cleanPart)
    .filter(Boolean);
  if (sourceParts.length > 1)
    return sourceParts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  const authorInitial = cleanPart(author ?? "")[0];
  const modelInitial = cleanPart(sourceParts[0] ?? source)[0];
  return `${authorInitial ?? ""}${modelInitial ?? ""}`.slice(0, 2).toUpperCase() || "M";
};

const isHubModelId = (modelId: string): boolean =>
  /^[\w.-]+\/[\w.-]+$/.test(modelId) && !modelId.startsWith("/");

const GENERIC_OWNERS = new Set(["models", "model", "data", "weights", "home", "mnt", "srv"]);

const OWNER_KEYWORDS: Array<[RegExp, string]> = [
  [/deepseek/i, "deepseek-ai"],
  [/\bglm|zai|chatglm/i, "zai-org"],
  [/qwen|qwq|qvq/i, "Qwen"],
  [/minimax/i, "MiniMaxAI"],
  [/kimi|moonshot/i, "moonshotai"],
  [/nemotron/i, "nvidia"],
  [/gemma/i, "google"],
  [/mimo/i, "XiaomiMiMo"],
  [/\blfm/i, "LiquidAI"],
  [/hunyuan|\bhy\d/i, "tencent"],
  [/stepfun|\bstep-?\d/i, "stepfun-ai"],
  [/llama/i, "meta-llama"],
  [/mistral|mixtral|magistral|devstral/i, "mistralai"],
  [/\bphi-?\d/i, "microsoft"],
  [/gpt-oss|whisper/i, "openai"],
  [/command-?r|\baya\b/i, "CohereLabs"],
  [/granite/i, "ibm-granite"],
  [/smollm|smolvlm|starcoder/i, "HuggingFaceTB"],
  [/internlm|intern-?vl/i, "internlm"],
  [/yi-|\byi\b/i, "01-ai"],
  [/falcon/i, "tiiuae"],
  [/seed-?oss|doubao/i, "ByteDance-Seed"],
  [/ernie/i, "baidu"],
  [/olmo|molmo|tulu/i, "allenai"],
  [/exaone/i, "LGAI-EXAONE"],
];

const avatarOwnerCandidates = (
  modelId: string,
  author?: string | null,
  label?: string,
): string[] => {
  const candidates: string[] = [];
  const push = (owner: string | undefined | null) => {
    const trimmed = owner?.trim();
    if (!trimmed || GENERIC_OWNERS.has(trimmed.toLowerCase())) return;
    if (!candidates.includes(trimmed)) candidates.push(trimmed);
  };
  push(author);
  if (isHubModelId(modelId)) push(modelId.split("/")[0]);
  const haystack = `${label ?? ""} ${modelId}`;
  for (const [pattern, owner] of OWNER_KEYWORDS) {
    if (pattern.test(haystack)) {
      push(owner);
      break;
    }
  }
  return candidates;
};

export function ModelLogo({
  modelId,
  author,
  label,
  size = "md",
  className,
}: {
  modelId: string;
  author?: string | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const candidates = avatarOwnerCandidates(modelId, author, label);
  const imageKey = `${modelId}\u0000${candidates.join(",")}`;
  const [imageState, setImageState] = useState({ imageKey, index: 0, loaded: false });
  if (imageState.imageKey !== imageKey) setImageState({ imageKey, index: 0, loaded: false });
  const dimensions = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const textSize = size === "lg" ? "text-[length:var(--fs-md)]" : "text-[length:var(--fs-xs)]";
  const title = label || modelId;
  const fallbackClass = PALETTE[hashString(title) % PALETTE.length];
  const owner = candidates[imageState.index];
  const requestImage = owner !== undefined;
  // A bundled logo is a static asset on our own origin: it is already in the
  // browser cache on the second view and needs no Hugging Face round trip on
  // the first, so it paints with the row instead of after it.
  const bundled = owner === undefined ? null : bundledLogoUrl(owner);
  const showImage = requestImage && (imageState.loaded || bundled !== null);

  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border font-mono font-medium tracking-[0.04em]",
        showImage ? "border-(--ui-border) bg-(--ui-surface) text-(--ui-muted)" : fallbackClass,
        dimensions,
        textSize,
        className,
      )}
      title={title}
    >
      {requestImage ? (
        <img
          src={bundled ?? hfAvatarUrl(modelId, owner)}
          alt=""
          className={cx(
            "absolute inset-0 h-full w-full object-cover",
            showImage ? "" : "opacity-0",
          )}
          // eager: these are 28px icons in the first screenful, and lazy-loading
          // them only delayed the swap from initials to logo.
          loading={bundled ? "eager" : "lazy"}
          decoding={bundled ? "sync" : "async"}
          onLoad={() =>
            setImageState((state) =>
              state.imageKey === imageKey ? { ...state, loaded: true } : state,
            )
          }
          onError={() =>
            setImageState((state) =>
              state.imageKey === imageKey
                ? { ...state, index: state.index + 1, loaded: false }
                : state,
            )
          }
        />
      ) : null}
      {showImage ? null : <span>{initialsFor(modelId, author, label)}</span>}
    </span>
  );
}
