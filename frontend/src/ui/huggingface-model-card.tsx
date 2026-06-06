"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download, ExternalLink, Heart, RefreshCw, Sparkles } from "lucide-react";
import type { HuggingFaceModel } from "@/lib/types";
import {
  engagementTier,
  hfModelUrl,
  modelDisplayName,
  quantizationLabels,
  type HuggingFaceModelCardPayload,
} from "@/lib/huggingface";
import { formatBytes, formatNumber } from "@/lib/formatters";
import { Button } from "./button";
import { MarkdownContent } from "./markdown-content";
import { RightDetailPanel } from "./right-detail-panel";
import { StatusPill } from "./status";
import { ModelLogo } from "./model-logo";

type HardwareFitSummary = {
  tone: "default" | "good" | "warning" | "danger" | "info";
  score: number;
  reason: string;
};

type ModelCardStats = {
  downloads: number;
  likes: number;
  tier: ReturnType<typeof engagementTier>;
};

export function HuggingFaceModelCardPanel({
  model,
  variants = [],
  fit,
  open,
  onClose,
}: {
  model: HuggingFaceModel | null;
  variants?: HuggingFaceModel[];
  fit?: HardwareFitSummary;
  open: boolean;
  onClose: () => void;
}) {
  const modelId = model?.modelId ?? "";
  const { error, loading, payload } = useModelCardPayload(modelId, open);
  const stats = modelCardStats(model, payload);

  if (!model) return null;

  const badges = modelCardBadges(model, payload);
  const readme = readmeContent({ error, loading, markdown: readmeMarkdown(payload?.readme) });

  return (
    <RightDetailPanel
      open={open}
      onClose={onClose}
      widthClassName="w-full sm:w-[min(620px,calc(100vw-72px))]"
      className="bg-(--bg)"
      title={modelDisplayName(model.modelId)}
      icon={<ModelLogo modelId={model.modelId} author={payload?.author ?? model.author} />}
      actions={
        <>
          <StatusPill tone={engagementTone(stats.tier)} variant="badge">
            {engagementLabel(stats.tier)}
          </StatusPill>
          <a href={hfModelUrl(model.modelId)} target="_blank" rel="noopener noreferrer">
            <Button variant="icon" size="sm" title="Open on Hugging Face">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        </>
      }
    >
      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          <span className="inline-flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5" />
            {formatNumber(stats.downloads)} downloads
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5" />
            {formatNumber(stats.likes)} likes
          </span>
          {badges.map((badge) => (
            <StatusPill key={`${badge.kind}:${badge.label}`} variant="badge">
              {badge.label}
            </StatusPill>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
          <section className="min-w-0">
            <div className="rounded-md border border-(--ui-border) bg-(--ui-surface)">
              <div className="flex h-9 items-center justify-between border-b border-(--ui-border) px-3">
                <div className="flex min-w-0 items-center gap-2 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
                  <Sparkles className="h-3.5 w-3.5 text-(--ui-info)" />
                  Model card
                </div>
                {loading ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-(--ui-muted)" />
                ) : null}
              </div>
              <div className="p-3">{readme}</div>
            </div>
          </section>
          <aside className="space-y-3">
            <HardwareFitPanel fit={fit} />
            <MetadataPanel payload={payload} model={model} />
            <QuantPanel variants={variants} />
            <FilesPanel payload={payload} />
          </aside>
        </div>
      </div>
    </RightDetailPanel>
  );
}

function useModelCardPayload(modelId: string, open: boolean) {
  const [payload, setPayload] = useState<HuggingFaceModelCardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/huggingface/model-card?modelId=${encodeURIComponent(modelId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as HuggingFaceModelCardPayload & { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load model card.");
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load model card.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [modelId]);

  const subscribe = useCallback(
    (_notify: () => void) => {
      if (open && modelId) void load();
      return () => {};
    },
    [load, modelId, open],
  );

  useSyncExternalStore(subscribe, getModelCardSnapshot, getModelCardSnapshot);

  return { error, loading, payload };
}

function modelCardStats(
  model: HuggingFaceModel | null,
  payload: HuggingFaceModelCardPayload | null,
): ModelCardStats {
  const downloads = payload?.downloads ?? model?.downloads ?? 0;
  const likes = payload?.likes ?? model?.likes ?? 0;
  return { downloads, likes, tier: engagementTier(likes, downloads) };
}

function modelCardBadges(
  model: HuggingFaceModel,
  payload: HuggingFaceModelCardPayload | null,
): Array<{ kind: string; label: string }> {
  return [
    { kind: "pipeline", label: payload?.pipeline_tag ?? model.pipeline_tag },
    { kind: "library", label: payload?.library_name ?? model.library_name },
  ].filter((badge): badge is { kind: string; label: string } => Boolean(badge.label));
}

function engagementTone(tier: ModelCardStats["tier"]) {
  if (tier === "heavy") return "good";
  if (tier === "warm") return "info";
  return "default";
}

function engagementLabel(tier: ModelCardStats["tier"]) {
  return tier === "heavy" ? "high signal" : tier;
}

function readmeContent({
  error,
  loading,
  markdown,
}: {
  error: string | null;
  loading: boolean;
  markdown: string;
}): ReactNode {
  if (error) return <p className="text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p>;
  if (markdown) return <MarkdownContent markdown={markdown} />;
  if (loading) return null;
  return (
    <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
      No README content was returned for this model.
    </p>
  );
}

function HardwareFitPanel({ fit }: { fit?: HardwareFitSummary }) {
  if (!fit) return null;
  return (
    <Panel title="Hardware fit">
      <div className="flex items-center justify-between gap-3 text-[length:var(--fs-sm)]">
        <span className="text-(--ui-muted)">Hardware score</span>
        <span className="font-mono text-(--ui-fg)">{fit.score}</span>
      </div>
      <p className="text-[length:var(--fs-sm)] leading-5 text-(--ui-fg)/80">{fit.reason}</p>
    </Panel>
  );
}

function MetadataPanel({
  payload,
  model,
}: {
  payload: HuggingFaceModelCardPayload | null;
  model: HuggingFaceModel;
}) {
  const rows = [
    ["Author", payload?.author ?? model.author ?? model.modelId.split("/")[0]],
    ["Updated", formatDate(payload?.lastModified ?? model.lastModified)],
    ["Created", formatDate(payload?.createdAt ?? model.createdAt)],
    ["Revision", payload?.sha ? payload.sha.slice(0, 10) : "main"],
  ];
  return (
    <Panel title="Repository">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-3 text-[length:var(--fs-sm)]"
        >
          <span className="text-(--ui-muted)">{label}</span>
          <span className="min-w-0 truncate text-right font-mono text-(--ui-fg)">{value}</span>
        </div>
      ))}
    </Panel>
  );
}

function QuantPanel({ variants }: { variants: HuggingFaceModel[] }) {
  const quantized = variants.filter((variant) => quantizationLabels(variant).length > 0);
  return (
    <Panel title="Quantizations">
      {quantized.length ? (
        <div className="space-y-2">
          {quantized.slice(0, 10).map((variant) => (
            <div key={variant._id} className="min-w-0">
              <div
                className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)"
                title={variant.modelId}
              >
                {variant.modelId}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {quantizationLabels(variant).map((label) => (
                  <StatusPill key={label} tone="warning" variant="badge">
                    {label}
                  </StatusPill>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          No quantized variants were grouped under this original.
        </p>
      )}
    </Panel>
  );
}

function FilesPanel({ payload }: { payload: HuggingFaceModelCardPayload | null }) {
  const files = (payload?.siblings ?? []).filter((file) => file.rfilename).slice(0, 8);
  if (!files.length) return null;
  return (
    <Panel title="Files">
      <div className="space-y-1.5">
        {files.map((file) => (
          <div
            key={file.rfilename}
            className="flex items-center justify-between gap-2 text-[length:var(--fs-sm)]"
          >
            <span className="min-w-0 truncate font-mono text-(--ui-fg)" title={file.rfilename}>
              {file.rfilename}
            </span>
            {typeof file.size === "number" ? (
              <span className="shrink-0 text-(--ui-muted)">{formatBytes(file.size)}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-(--ui-border) bg-(--ui-surface) p-3">
      <h3 className="mb-2 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function readmeMarkdown(readme?: string): string {
  if (!readme) return "";
  return readableMarkdownFromHtml(readme.replace(/^---[\s\S]*?---\s*/m, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function readableMarkdownFromHtml(markdown: string): string {
  return markdown
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, content: string) => {
      const text = htmlText(content);
      return text ? `\n${"#".repeat(Number(level))} ${text}\n` : "\n";
    })
    .replace(
      /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
      (_, _quote: string, href: string, content: string) => {
        const label = htmlText(content) || href;
        return href ? `[${label}](${href})` : label;
      },
    )
    .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi, (_, _quote: string, alt: string) =>
      htmlEntityDecode(alt),
    )
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|details|summary|li|ul|ol|table|thead|tbody|tr|td|th)>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

function htmlText(value: string): string {
  return htmlEntityDecode(
    value
      .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi, "$2")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function htmlEntityDecode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function formatDate(value?: string): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const getModelCardSnapshot = (): number => 0;
