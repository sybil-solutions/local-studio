"use client";

import { Cpu, Database, GitBranch, Settings } from "@/ui/icon-registry";
import { CheckboxRow, FormField, FormSection, Input, Slider } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabResources({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "resources");
  return (
    <div className="space-y-6">
      <ParallelismSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <GpuSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {capabilities.memoryManagement ? (
        <FormSection icon={<Database className="h-4 w-4" />} title="Memory Management">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Swap Space (GB)">
              <Input
                type="number"
                value={recipe.swap_space || ""}
                onChange={(e) =>
                  onChange({ ...recipe, swap_space: Number(e.target.value) || undefined })
                }
                placeholder="0"
              />
            </FormField>
            <FormField label="CPU Offload (GB)">
              <Input
                type="number"
                value={recipe.cpu_offload_gb || ""}
                onChange={(e) =>
                  onChange({ ...recipe, cpu_offload_gb: Number(e.target.value) || undefined })
                }
                placeholder="0"
              />
            </FormField>
            <FormField label="GPU Blocks Override">
              <Input
                type="number"
                value={recipe.num_gpu_blocks_override || ""}
                onChange={(e) =>
                  onChange({
                    ...recipe,
                    num_gpu_blocks_override: Number(e.target.value) || undefined,
                  })
                }
                placeholder="Auto"
              />
            </FormField>
          </div>
        </FormSection>
      ) : null}
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Resource Options`}
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

function ParallelismSection({ recipe, onChange, capabilities }: SectionProps) {
  if (capabilities.parallelism === "none") return null;
  return (
    <FormSection icon={<GitBranch className="h-4 w-4" />} title="Parallelism">
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Tensor Parallel">
          <Input
            type="number"
            min={1}
            value={recipe.tp ?? recipe.tensor_parallel_size ?? 1}
            onChange={(e) =>
              onChange({
                ...recipe,
                tp: Number(e.target.value),
                tensor_parallel_size: Number(e.target.value),
              })
            }
          />
        </FormField>
        <FormField label="Pipeline Parallel">
          <Input
            type="number"
            min={1}
            value={recipe.pp ?? recipe.pipeline_parallel_size ?? 1}
            onChange={(e) =>
              onChange({
                ...recipe,
                pp: Number(e.target.value),
                pipeline_parallel_size: Number(e.target.value),
              })
            }
          />
        </FormField>
        {capabilities.parallelism === "full" ? (
          <FormField label="Data Parallel">
            <Input
              type="number"
              min={1}
              value={recipe.data_parallel_size || ""}
              onChange={(e) =>
                onChange({ ...recipe, data_parallel_size: Number(e.target.value) || undefined })
              }
              placeholder="1"
            />
          </FormField>
        ) : null}
      </div>
      {capabilities.parallelism === "full" ? (
        <CheckboxRow
          checked={recipe.enable_expert_parallel || false}
          onChange={(checked) => onChange({ ...recipe, enable_expert_parallel: checked })}
          label="Expert Parallel (MoE)"
          description="Shard MoE experts across the parallel group."
        />
      ) : null}
    </FormSection>
  );
}

function GpuSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.gpuMemoryUtil && !capabilities.visibleDevices) return null;
  const gpuUtil = recipe.gpu_memory_utilization ?? 0.9;
  return (
    <FormSection icon={<Cpu className="h-4 w-4" />} title="GPU">
      {capabilities.gpuMemoryUtil ? (
        <FormField
          label="GPU Memory Utilization"
          description={
            capabilities.backend === "sglang" ? "Maps to SGLang --mem-fraction-static." : undefined
          }
        >
          <div className="flex items-center gap-3">
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={gpuUtil}
              onChange={(next) => onChange({ ...recipe, gpu_memory_utilization: next })}
              aria-label="GPU memory utilization"
            />
            <span className="atlas-num w-12 shrink-0 text-right text-sm tabular-nums">
              {Math.round(gpuUtil * 100)}%
            </span>
          </div>
        </FormField>
      ) : null}
      {capabilities.visibleDevices ? (
        <FormField label="Visible Devices">
          <Input
            type="text"
            value={recipe.visible_devices ?? recipe.cuda_visible_devices ?? ""}
            onChange={(e) =>
              onChange({
                ...recipe,
                visible_devices: e.target.value || undefined,
                cuda_visible_devices: undefined,
              })
            }
            placeholder="0,1,2,3 or all"
          />
        </FormField>
      ) : null}
    </FormSection>
  );
}
