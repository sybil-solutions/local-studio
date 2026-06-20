"use client";

import { Boxes, Layers, Settings } from "@/ui/icon-registry";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabModel({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "model");
  return (
    <div className="space-y-6">
      <ContextSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <WeightsSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Model Options`}
          icon={<Settings className="h-4 w-4" />}
          options={options}
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      ) : null}
    </div>
  );
}

type SectionProps = RecipeModalSectionProps;

function ContextSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.contextLength && !capabilities.seed) return null;
  return (
    <FormSection icon={<Layers className="h-4 w-4" />} title="Model & Context">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.contextLength ? (
          <FormField label="Context Length">
            <Input
              type="number"
              value={recipe.max_model_len || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })
              }
              placeholder={capabilities.backend === "llamacpp" ? "8192" : "32768"}
            />
          </FormField>
        ) : null}
        {capabilities.seed ? (
          <FormField label="Seed">
            <Input
              type="number"
              value={recipe.seed || ""}
              onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
              placeholder="Random"
            />
          </FormField>
        ) : null}
      </div>
    </FormSection>
  );
}

function WeightsSection({ recipe, onChange, capabilities }: SectionProps) {
  if (
    !capabilities.advancedModelLoading &&
    !capabilities.quantization &&
    !capabilities.trustRemoteCode
  )
    return null;
  return (
    <FormSection icon={<Boxes className="h-4 w-4" />} title="Weights & Quantization">
      {capabilities.advancedModelLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tokenizer">
              <Input
                type="text"
                value={recipe.tokenizer || ""}
                onChange={(e) => onChange({ ...recipe, tokenizer: e.target.value || undefined })}
                placeholder="Path or name"
              />
            </FormField>
            <FormField label="Tokenizer Mode">
              <Select
                value={recipe.tokenizer_mode || "auto"}
                onChange={(e) =>
                  onChange({
                    ...recipe,
                    tokenizer_mode:
                      e.target.value === "auto"
                        ? undefined
                        : (e.target.value as "auto" | "slow" | "mistral"),
                  })
                }
              >
                <option value="auto">Auto</option>
                <option value="slow">Slow</option>
                <option value="mistral">Mistral</option>
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Revision">
              <Input
                type="text"
                value={recipe.revision || ""}
                onChange={(e) => onChange({ ...recipe, revision: e.target.value || undefined })}
                placeholder="e.g., main"
              />
            </FormField>
            <FormField label="Load Format">
              <Input
                type="text"
                value={recipe.load_format || ""}
                onChange={(e) => onChange({ ...recipe, load_format: e.target.value || undefined })}
                placeholder="auto, safetensors"
              />
            </FormField>
          </div>
          <FormField label="Quantization Param Path">
            <Input
              type="text"
              value={recipe.quantization_param_path || ""}
              onChange={(e) =>
                onChange({ ...recipe, quantization_param_path: e.target.value || undefined })
              }
              placeholder="Path to calibration file"
            />
          </FormField>
        </>
      ) : null}
      {capabilities.quantization ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quantization">
            <Input
              type="text"
              value={recipe.quantization || ""}
              onChange={(e) => onChange({ ...recipe, quantization: e.target.value || undefined })}
              placeholder="awq, gptq, fp8"
            />
          </FormField>
          <FormField label="Dtype">
            <Select
              value={recipe.dtype || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  dtype: e.target.value === "auto" ? undefined : e.target.value,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="float16">float16</option>
              <option value="bfloat16">bfloat16</option>
              <option value="float32">float32</option>
            </Select>
          </FormField>
        </div>
      ) : null}
      {capabilities.trustRemoteCode ? (
        <CheckboxRow
          checked={recipe.trust_remote_code || false}
          onChange={(checked) => onChange({ ...recipe, trust_remote_code: checked })}
          label="Trust Remote Code"
          description="Allow the model repo to execute custom modeling code."
        />
      ) : null}
    </FormSection>
  );
}
