"use client";

import { useState } from "react";
import { hfAvatarUrl } from "@/lib/huggingface";
import { cx } from "./utils";

const FALLBACK_COLORS = ["#3B82F6", "#14B8A6", "#8B5CF6", "#F59E0B", "#EF4444", "#64748B"] as const;

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#D97757",
  aws: "#FF9900",
  browser: "#2563EB",
  chrome: "#4285F4",
  cloudflare: "#F48120",
  codex: "#10A37F",
  computer: "#60A5FA",
  deepseek: "#4D6BFE",
  figma: "#A259FF",
  github: "#F0F6FC",
  gmail: "#EA4335",
  google: "#4285F4",
  groq: "#F55036",
  huggingface: "#FFD21E",
  kimi: "#8B5CF6",
  mistral: "#F7D046",
  nvidia: "#76B900",
  openai: "#10A37F",
  openrouter: "#8B5CF6",
  xai: "#E5E7EB",
  zai: "#111827",
};

const LOGO_OWNERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/anthropic|claude/i, "anthropic"],
  [/amazon|bedrock|\baws\b/i, "amazon"],
  [/azure|microsoft/i, "microsoft"],
  [/browser|codex|computer use|openai/i, "openai"],
  [/chrome|google|gmail|calendar|drive|gemini|vertex/i, "google"],
  [/cerebras/i, "cerebras"],
  [/cloudflare/i, "Cloudflare"],
  [/deepseek/i, "deepseek-ai"],
  [/figma/i, "figma"],
  [/fireworks/i, "fireworks-ai"],
  [/github/i, "github"],
  [/groq/i, "groq"],
  [/hugging ?face/i, "huggingface"],
  [/kimi|moonshot/i, "moonshotai"],
  [/minimax/i, "MiniMaxAI"],
  [/mistral/i, "mistralai"],
  [/nvidia/i, "nvidia"],
  [/openrouter/i, "OpenRouter"],
  [/together/i, "togethercomputer"],
  [/xai/i, "xai-org"],
  [/xiaomi|mimo/i, "XiaomiMiMo"],
  [/z\.?ai|\bglm/i, "zai-org"],
];

const hash = (value: string): number =>
  Array.from(value).reduce((current, character) => current * 31 + character.charCodeAt(0), 0);

const initials = (label: string): string => {
  const parts = label
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : parts[0]?.slice(0, 2))
      ?.toUpperCase()
      .slice(0, 2) || "LS"
  );
};

const normalizedColor = (identity: string, brandColor?: string | null): string => {
  if (brandColor && /^#[0-9a-f]{6}$/i.test(brandColor)) return brandColor;
  const lower = identity.toLowerCase();
  const known = Object.entries(PROVIDER_COLORS).find(([key]) => lower.includes(key));
  return known?.[1] ?? FALLBACK_COLORS[Math.abs(hash(lower)) % FALLBACK_COLORS.length];
};

const inferredImageUrl = (
  identity: string,
  label: string,
  company?: string | null,
): string | null => {
  const source = `${identity} ${label} ${company ?? ""}`;
  if (/local studio/i.test(source)) return "/icons/icon-192.png";
  const owner = LOGO_OWNERS.find(([pattern]) => pattern.test(source))?.[1];
  return owner ? hfAvatarUrl(identity, owner) : null;
};

export function ResourceLogo({
  identity,
  label,
  company,
  brandColor,
  imageUrl,
  size = "sm",
  className,
}: {
  identity: string;
  label: string;
  company?: string | null;
  brandColor?: string | null;
  imageUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const resolvedImageUrl = imageUrl || inferredImageUrl(identity, label, company);
  const imageKey = resolvedImageUrl ?? "";
  const [imageState, setImageState] = useState({ imageKey, failed: false, loaded: false });
  if (imageState.imageKey !== imageKey) {
    setImageState({ imageKey, failed: false, loaded: false });
  }
  const color = normalizedColor(`${identity} ${label} ${company ?? ""}`, brandColor);
  const dimensions = size === "md" ? "h-9 w-9" : "h-7 w-7";
  const requestImage = Boolean(resolvedImageUrl) && !imageState.failed;
  const showImage = requestImage && imageState.loaded;
  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border font-mono text-[length:var(--fs-xs)] font-semibold tracking-[0.04em]",
        dimensions,
        className,
      )}
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}1F`,
      }}
      title={label}
      aria-label={`${label} logo`}
    >
      {requestImage ? (
        <img
          src={resolvedImageUrl ?? undefined}
          alt=""
          className={cx(
            "absolute inset-0 h-full w-full object-cover",
            showImage ? "" : "opacity-0",
          )}
          loading="lazy"
          onLoad={() =>
            setImageState((state) =>
              state.imageKey === imageKey ? { ...state, loaded: true } : state,
            )
          }
          onError={() =>
            setImageState((state) =>
              state.imageKey === imageKey ? { ...state, failed: true, loaded: false } : state,
            )
          }
        />
      ) : null}
      {showImage ? null : initials(label)}
    </span>
  );
}
