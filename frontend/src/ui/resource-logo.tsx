"use client";

import { useState } from "react";
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

export function ResourceLogo({
  identity,
  label,
  brandColor,
  imageUrl,
  size = "sm",
  className,
}: {
  identity: string;
  label: string;
  brandColor?: string | null;
  imageUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = normalizedColor(`${identity} ${label}`, brandColor);
  const dimensions = size === "md" ? "h-9 w-9" : "h-7 w-7";
  const imageVisible = Boolean(imageUrl) && !imageFailed;
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
      {imageVisible ? (
        <img
          src={imageUrl ?? undefined}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initials(label)
      )}
    </span>
  );
}
