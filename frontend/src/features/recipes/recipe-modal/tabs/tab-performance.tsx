"use client";

import { Clock, Database, Settings, Zap } from "@/ui/icon-registry";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabPerformance({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "performance");
  return (
    <div className="space-y-6">
      {capabilities.cudaGraphs ? <CudaGraphsSection recipe={recipe} onChange={onChange} /> : null}
      <KvCacheSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <SchedulerSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Performance Options`}
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

function KvCacheSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.kvCacheDtype && !capabilities.blockSize && !capabilities.caching) return null;
  return (
    <FormSection icon={<Database className="h-4 w-4" />} title="KV Cache & Memory">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.kvCacheDtype ? (
          <FormField label="KV Cache Dtype">
            <Select
              value={recipe.kv_cache_dtype || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  kv_cache_dtype: e.target.value === "auto" ? undefined : e.target.value,
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="fp8">FP8</option>
              <option value="fp8_e5m2">FP8 E5M2</option>
              <option value="fp8_e4m3">FP8 E4M3</option>
            </Select>
          </FormField>
        ) : null}
        {capabilities.blockSize ? (
          <FormField label="Block Size">
            <Select
              value={recipe.block_size || "16"}
              onChange={(e) =>
                onChange({ ...recipe, block_size: Number(e.target.value) || undefined })
              }
            >
              <option value="8">8</option>
              <option value="16">16</option>
              <option value="32">32</option>
            </Select>
          </FormField>
        ) : null}
      </div>
      {capabilities.caching ? (
        <div className="grid grid-cols-2 gap-3">
          <CheckboxRow
            checked={recipe.enable_prefix_caching || false}
            onChange={(checked) => onChange({ ...recipe, enable_prefix_caching: checked })}
            label="Prefix Caching"
            description="Cache shared prefixes"
          />
          <CheckboxRow
            checked={recipe.enable_chunked_prefill || false}
            onChange={(checked) => onChange({ ...recipe, enable_chunked_prefill: checked })}
            label="Chunked Prefill"
            description="Interleave prefill/decode"
          />
        </div>
      ) : null}
    </FormSection>
  );
}

function SchedulerSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.maxNumSeqs && !capabilities.schedulerAdvanced) return null;
  return (
    <FormSection icon={<Clock className="h-4 w-4" />} title="Scheduler & Batching">
      <div className="grid grid-cols-3 gap-3">
        {capabilities.maxNumSeqs ? (
          <FormField
            label="Max Sequences"
            description={capabilities.backend === "sglang" ? "--max-running-requests" : undefined}
          >
            <Input
              type="number"
              value={recipe.max_num_seqs || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_num_seqs: Number(e.target.value) || undefined })
              }
              placeholder="256"
            />
          </FormField>
        ) : null}
        {capabilities.schedulerAdvanced ? (
          <>
            <FormField label="Max Batched Tokens">
              <Input
                type="number"
                value={recipe.max_num_batched_tokens || ""}
                onChange={(e) =>
                  onChange({
                    ...recipe,
                    max_num_batched_tokens: Number(e.target.value) || undefined,
                  })
                }
                placeholder="Auto"
              />
            </FormField>
            <FormField label="Max Paddings">
              <Input
                type="number"
                value={recipe.max_paddings || ""}
                onChange={(e) =>
                  onChange({ ...recipe, max_paddings: Number(e.target.value) || undefined })
                }
                placeholder="Auto"
              />
            </FormField>
          </>
        ) : null}
      </div>
      {capabilities.schedulerAdvanced ? (
        <FormField label="Scheduling Policy">
          <Select
            value={recipe.scheduling_policy || ""}
            onChange={(e) =>
              onChange({
                ...recipe,
                scheduling_policy: e.target.value
                  ? (e.target.value as "fcfs" | "priority")
                  : undefined,
              })
            }
          >
            <option value="">Default</option>
            <option value="fcfs">FCFS (First Come First Serve)</option>
            <option value="priority">Priority</option>
          </Select>
        </FormField>
      ) : null}
    </FormSection>
  );
}

function CudaGraphsSection({
  recipe,
  onChange,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
}) {
  return (
    <FormSection icon={<Zap className="h-4 w-4" />} title="CUDA Graphs & Compilation">
      <div className="grid grid-cols-2 gap-3">
        <CheckboxRow
          checked={recipe.enforce_eager || false}
          onChange={(checked) => onChange({ ...recipe, enforce_eager: checked })}
          label="Enforce Eager Mode"
          description="Disables CUDA graphs for debugging"
        />
        <CheckboxRow
          checked={recipe.disable_cuda_graph || false}
          onChange={(checked) => onChange({ ...recipe, disable_cuda_graph: checked })}
          label="Disable CUDA Graph"
          description="Skip graph capture for dynamic shapes"
        />
        <CheckboxRow
          checked={recipe.use_v2_block_manager || false}
          onChange={(checked) => onChange({ ...recipe, use_v2_block_manager: checked })}
          label="v2 Block Manager"
          description="New memory management"
        />
        <CheckboxRow
          checked={recipe.disable_custom_all_reduce || false}
          onChange={(checked) => onChange({ ...recipe, disable_custom_all_reduce: checked })}
          label="Disable Custom AllReduce"
          description="Use default NCCL collectives"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="CUDA Graph Max Batch Size">
          <Input
            type="number"
            value={recipe.cuda_graph_max_bs || ""}
            onChange={(e) =>
              onChange({ ...recipe, cuda_graph_max_bs: Number(e.target.value) || undefined })
            }
            placeholder="Default"
          />
        </FormField>
        <FormField label="Compilation Config">
          <Input
            type="text"
            value={recipe.compilation_config || ""}
            onChange={(e) =>
              onChange({ ...recipe, compilation_config: e.target.value || undefined })
            }
            placeholder={`e.g., {"level": 3}`}
          />
        </FormField>
      </div>
    </FormSection>
  );
}
