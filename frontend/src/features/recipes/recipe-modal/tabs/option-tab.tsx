"use client";

import { Fragment, type ReactNode } from "react";
import { Settings } from "@/ui/icon-registry";
import { CheckboxRow, FormField, FormSection, Input, SegmentedControl, Select, Slider } from "@/ui";
import { coerceBoolean } from "@/features/recipes/coercion";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import type { LlamacppOption } from "@/features/recipes/llamacpp-options";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import {
  forBackend,
  type OptionTabId,
  RECIPE_SECTIONS,
  type RecipeField,
  type RecipeSection,
} from "@/features/recipes/recipe-option-sections";
import {
  type VisionMode,
  visionForMode,
  visionModeForRecipe,
} from "@/features/recipes/recipe-vision";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalTabProps } from "./tab-props";

const VISION_MODES = [
  { id: "auto", label: "Auto" },
  { id: "enabled", label: "Enabled" },
  { id: "text", label: "Text only" },
] as const;

const VISION_DESCRIPTIONS: Record<VisionMode, string> = {
  auto: "Detect image support from the model metadata and architecture.",
  enabled: "Advertise image input even when model metadata is incomplete.",
  text: "Keep this recipe text-only even when the model appears multimodal.",
};

const GRID: Record<1 | 2 | 3, string> = {
  1: "grid grid-cols-1 gap-3",
  2: "grid grid-cols-2 gap-3",
  3: "grid grid-cols-3 gap-3",
};

const parallelSize = (value: string): number => Math.max(1, Math.floor(Number(value) || 1));

const firstDefined = (recipe: RecipeEditor, keys: readonly (keyof RecipeEditor)[]): unknown =>
  keys.map((key) => recipe[key]).find((value) => value !== undefined && value !== null);

/** An engine-native flag (llama.cpp / MLX) stored verbatim in `extra_args`. */
function renderEngineOption(
  option: LlamacppOption,
  { getExtraArgValueForKey, setExtraArgValueForKey }: RecipeModalTabProps,
): ReactNode {
  const value = getExtraArgValueForKey(option.key);
  if (option.type === "boolean")
    return (
      <CheckboxRow
        checked={coerceBoolean(value) ?? false}
        onChange={(checked) => setExtraArgValueForKey(option.key, checked ? true : undefined)}
        label={option.label}
        description={option.description}
      />
    );
  if (option.type === "select")
    return (
      <FormField label={option.label} description={option.description}>
        <Select
          value={value ? String(value) : ""}
          onChange={(e) => setExtraArgValueForKey(option.key, e.target.value || undefined)}
        >
          <option value="">Default</option>
          {option.options?.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
      </FormField>
    );
  const inputType = option.type === "number" ? "number" : "text";
  return (
    <FormField label={option.label} description={option.description}>
      <Input
        type={inputType}
        value={value !== undefined && value !== null ? String(value) : ""}
        onChange={(e) =>
          setExtraArgValueForKey(
            option.key,
            inputType === "number"
              ? e.target.value
                ? Number(e.target.value)
                : undefined
              : e.target.value,
          )
        }
        placeholder={option.placeholder}
      />
    </FormField>
  );
}

function renderField(spec: RecipeField, props: RecipeModalTabProps): ReactNode {
  const { recipe, onChange, capabilities } = props;
  const backend = capabilities.backend;
  const description = forBackend(spec.description, backend);
  const field = createRecipeFields(recipe, onChange);
  const patch = (entries: [keyof RecipeEditor, unknown][]) =>
    onChange({ ...recipe, ...(Object.fromEntries(entries) as Partial<RecipeEditor>) });

  switch (spec.kind) {
    case "text":
    case "number":
      return field.input(spec.name, spec.label, {
        type: spec.kind,
        description,
        min: spec.min,
        placeholder: forBackend(spec.placeholder, backend),
      });
    case "choices":
      return field.choices(spec.name, spec.label, spec.choices, {
        description,
        fallback: spec.fallback,
        empty: spec.empty,
        numeric: spec.numeric,
        zeroIsEmpty: spec.zeroIsEmpty,
      });
    case "checkbox":
      return field.checkbox(spec.name, spec.label, description);
    case "parallel-size":
      return (
        <FormField label={spec.label}>
          <Input
            type="number"
            min={1}
            value={Number(firstDefined(recipe, spec.keys) ?? 1)}
            onChange={(event) => {
              const size = parallelSize(event.target.value);
              patch(spec.keys.map((key) => [key, size]));
            }}
          />
        </FormField>
      );
    case "device-list":
      return (
        <FormField label={spec.label}>
          <Input
            value={String(firstDefined(recipe, spec.keys) ?? "")}
            onChange={(event) =>
              patch(
                spec.keys.map((key, index) => [
                  key,
                  index === 0 ? event.target.value || undefined : undefined,
                ]),
              )
            }
            placeholder={spec.placeholder}
          />
        </FormField>
      );
    case "gpu-memory": {
      const gpuUtil = recipe.gpu_memory_utilization ?? 0.9;
      return (
        <FormField asGroup label={spec.label} description={description}>
          <div className="flex items-center gap-3">
            <Slider
              min={0.05}
              max={1}
              step={0.05}
              value={gpuUtil}
              onChange={(value) => onChange({ ...recipe, gpu_memory_utilization: value })}
              aria-label="GPU memory utilization"
            />
            <span className="atlas-num w-12 shrink-0 text-right text-sm tabular-nums">
              {Math.round(gpuUtil * 100)}%
            </span>
          </div>
        </FormField>
      );
    }
    case "vision": {
      const mode = visionModeForRecipe(recipe);
      return (
        <FormField asGroup label={spec.label} description={VISION_DESCRIPTIONS[mode]}>
          <SegmentedControl
            items={[...VISION_MODES]}
            value={mode}
            onChange={(value) => onChange({ ...recipe, vision: visionForMode(value) })}
            size="sm"
          />
        </FormField>
      );
    }
    case "engine-option":
      return renderEngineOption(spec.option, props);
  }
}

function RecipeSectionView({
  section: { icon: Icon, title, cols, fields },
  helpText,
  ...props
}: RecipeModalTabProps & { section: RecipeSection; helpText?: string }) {
  const backend = props.capabilities.backend;
  const visible = fields.filter(
    (spec) =>
      (!spec.backends || spec.backends.includes(backend)) &&
      (!spec.visibleWhen || Boolean(props.recipe[spec.visibleWhen])),
  );
  if (visible.length === 0) return null;
  const nodes = visible.map((spec, index) => {
    const node = renderField(spec, props);
    const span = cols === 3 ? "col-span-3" : "col-span-2";
    return <Fragment key={index}>{spec.full ? <div className={span}>{node}</div> : node}</Fragment>;
  });

  return (
    <FormSection icon={<Icon className="h-4 w-4" />} title={title}>
      {visible.length > 1 ? <div className={GRID[cols]}>{nodes}</div> : nodes}
      {helpText ? <p className="text-xs text-(--ui-muted)">{helpText}</p> : null}
    </FormSection>
  );
}

const OPTION_TITLES: Record<OptionTabId, string> = {
  model: "Model Options",
  resources: "Resource Options",
  performance: "Performance Options",
  features: "Sampling & Features",
};

const WIDE_OPTION = /prompt|template|grammar|control|model|adapter/;

/**
 * Engine-native options (llama.cpp / MLX) as an editor section. Every value is
 * stored verbatim in `extra_args`, so these are the exact flags the engine
 * receives.
 */
const engineSection = (title: string, options: LlamacppOption[]): RecipeSection => ({
  icon: Settings,
  title,
  cols: 2,
  fields: options.map((option) => ({
    kind: "engine-option",
    option,
    label: option.label,
    full: option.type === "text" && WIDE_OPTION.test(option.key),
  })),
});

export function RecipeModalOptionTab({
  tab,
  ...props
}: RecipeModalTabProps & { tab: OptionTabId }) {
  const { backend, options, sections } = props.capabilities;
  const engineOptions = getEngineOptions(options, tab);
  return (
    <div className="space-y-6">
      {(sections[tab] ?? []).map((id) => (
        <RecipeSectionView key={id} section={RECIPE_SECTIONS[id]} {...props} />
      ))}
      {engineOptions.length ? (
        <RecipeSectionView
          section={engineSection(`${ENGINE_LABEL[backend]} ${OPTION_TITLES[tab]}`, engineOptions)}
          helpText={
            tab === "features" && options === "llamacpp"
              ? "All llama.cpp flags are supported via Extra CLI Arguments. These cover the most-used options."
              : undefined
          }
          {...props}
        />
      ) : null}
    </div>
  );
}
