"use client";

import { useRouter } from "next/navigation";
import {
  Card,
  Table,
  THead,
  TBody,
  TRow,
  TH,
  TCell,
  StatusPill,
  SectionLabel,
  type UiTone,
} from "@/ui";
import type { ProcessInfo, RecipeWithStatus } from "@/lib/types";
import { buildReadinessMatrixRows } from "./readiness-matrix-model";

interface ReadinessMatrixProps {
  recipes: RecipeWithStatus[];
  currentRecipe: RecipeWithStatus | null;
  currentProcess: ProcessInfo | null;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
}

export function ReadinessMatrix({
  recipes,
  currentRecipe,
  currentProcess,
  lifecycleStatus,
}: ReadinessMatrixProps) {
  const router = useRouter();
  const servedModelId = currentProcess?.served_model_name ?? null;
  const rows = buildReadinessMatrixRows(recipes, currentRecipe, servedModelId, lifecycleStatus);

  if (recipes.length === 0) return null;

  return (
    <Card bordered className="mt-6" padding="sm">
      <SectionLabel>Readiness matrix</SectionLabel>
      <p className="mb-3 text-[length:var(--fs-xs)] text-(--ui-muted)">
        Configured recipe → runtime process → served model → selected model
      </p>
      <Table bordered={false} tableClassName="text-[length:var(--fs-sm)]">
        <THead>
          <TRow>
            <TH>Recipe</TH>
            <TH>Configured</TH>
            <TH>Process</TH>
            <TH>Served</TH>
            <TH>Selected</TH>
            <TH>Status</TH>
          </TRow>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TRow key={row.recipe.id}>
              <TCell>
                <button
                  type="button"
                  onClick={() => router.push(`/recipes?id=${encodeURIComponent(row.recipe.id)}`)}
                  className="font-medium text-(--ui-fg) hover:underline"
                  title="Open recipe editor"
                >
                  {row.recipe.name || row.recipe.id}
                </button>
              </TCell>
              <TCell>
                <StatusPill variant="badge" tone={row.configured ? "good" : "default"}>
                  {row.configured ? "yes" : "no"}
                </StatusPill>
              </TCell>
              <TCell>
                <StatusPill variant="badge" tone={processTone(row.processState)}>
                  {row.processState}
                </StatusPill>
              </TCell>
              <TCell>
                <StatusPill variant="badge" tone={row.served ? "good" : "default"}>
                  {row.served ? "yes" : "no"}
                </StatusPill>
              </TCell>
              <TCell>
                <StatusPill variant="badge" tone={row.selected ? "good" : "default"}>
                  {row.selected ? "yes" : "no"}
                </StatusPill>
              </TCell>
              <TCell>
                <StatusPill variant="badge" tone={row.mismatch ? "danger" : "good"}>
                  {row.mismatch ? "mismatch" : row.processState === "running" ? "ready" : "—"}
                </StatusPill>
              </TCell>
            </TRow>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function processTone(state: "stopped" | "starting" | "running" | "error"): UiTone {
  switch (state) {
    case "running":
      return "good";
    case "error":
      return "danger";
    case "starting":
      return "warning";
    default:
      return "default";
  }
}
