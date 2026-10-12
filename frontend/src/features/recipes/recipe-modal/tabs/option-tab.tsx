"use client";

import type { ReactNode } from "react";
import {
  Boxes,
  Brain,
  Clock,
  Cpu,
  Database,
  Eye,
  GitBranch,
  Layers,
  MessageSquare,
  Settings,
  Wrench,
  Zap,
} from "@/ui/icon-registry";
import { FormField, FormSection, Input, SegmentedControl, Slider } from "@/ui";
import { ENGINE_LABEL } from "@/features/recipes/engine-capabilities";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import {
  type VisionMode,
  visionForMode,
  visionModeForRecipe,
} from "@/features/recipes/recipe-vision";
import { createRecipeFields } from "../recipe-fields";
import type { RecipeModalTabId } from "./tab-id";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

type OptionTabId = Extract<RecipeModalTabId, "model" | "resources" | "performance" | "features">;
type SectionProps = RecipeModalSectionProps;
type Section = (props: SectionProps) => ReactNode;

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

function Context({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.contextLength && !capabilities.seed) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Layers className="h-4 w-4" />} title="Model & Context">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.contextLength
          ? field.input("max_model_len", "Context Length", {
              type: "number",
              placeholder: "32768",
            })
          : null}
        {capabilities.seed
          ? field.input("seed", "Seed", { type: "number", placeholder: "Random" })
          : null}
      </div>
    </FormSection>
  );
}

function Weights({ recipe, onChange, capabilities }: SectionProps) {
  if (
    !capabilities.advancedModelLoading &&
    !capabilities.quantization &&
    !capabilities.trustRemoteCode
  )
    return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Boxes className="h-4 w-4" />} title="Weights & Quantization">
      {capabilities.advancedModelLoading ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {field.input("tokenizer", "Tokenizer", { placeholder: "Path or name" })}
            {field.choices(
              "tokenizer_mode",
              "Tokenizer Mode",
              { auto: "Auto", slow: "Slow", mistral: "Mistral" },
              { fallback: "auto", empty: "auto" },
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field.input("revision", "Revision", { placeholder: "e.g., main" })}
            {field.input("load_format", "Load Format", { placeholder: "auto, safetensors" })}
          </div>
          {field.input("quantization_param_path", "Quantization Param Path", {
            placeholder: "Path to calibration file",
          })}
        </>
      ) : null}
      {capabilities.quantization ? (
        <div className="grid grid-cols-2 gap-3">
          {field.input("quantization", "Quantization", { placeholder: "awq, gptq, fp8" })}
          {field.choices(
            "dtype",
            "Dtype",
            { auto: "Auto", float16: "float16", bfloat16: "bfloat16", float32: "float32" },
            { fallback: "auto", empty: "auto" },
          )}
        </div>
      ) : null}
      {capabilities.trustRemoteCode
        ? field.checkbox(
            "trust_remote_code",
            "Trust Remote Code",
            "Allow the model repo to execute custom modeling code.",
          )
        : null}
    </FormSection>
  );
}

const parallelSize = (value: string): number => Math.max(1, Math.floor(Number(value) || 1));

function Parallelism({ recipe, onChange, capabilities }: SectionProps) {
  if (capabilities.parallelism === "none") return null;
  const field = createRecipeFields(recipe, onChange);
  const sizeInput = (
    label: string,
    value: number,
    patch: (size: number) => Partial<RecipeEditor>,
  ) => (
    <FormField label={label}>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange({ ...recipe, ...patch(parallelSize(event.target.value)) })}
      />
    </FormField>
  );
  return (
    <FormSection icon={<GitBranch className="h-4 w-4" />} title="Parallelism">
      <div className="grid grid-cols-3 gap-3">
        {sizeInput("Tensor Parallel", recipe.tp ?? recipe.tensor_parallel_size ?? 1, (size) => ({
          tp: size,
          tensor_parallel_size: size,
        }))}
        {sizeInput(
          "Pipeline Parallel",
          recipe.pp ?? recipe.pipeline_parallel_size ?? 1,
          (size) => ({
            pp: size,
            pipeline_parallel_size: size,
          }),
        )}
        {capabilities.parallelism === "full"
          ? field.input("data_parallel_size", "Data Parallel", {
              type: "number",
              min: 1,
              placeholder: "1",
            })
          : null}
      </div>
      {capabilities.parallelism === "full"
        ? field.checkbox(
            "enable_expert_parallel",
            "Expert Parallel (MoE)",
            "Shard MoE experts across the parallel group.",
          )
        : null}
    </FormSection>
  );
}

function Gpu({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.gpuMemoryUtil && !capabilities.visibleDevices) return null;
  const gpuUtil = recipe.gpu_memory_utilization ?? 0.9;
  return (
    <FormSection icon={<Cpu className="h-4 w-4" />} title="GPU">
      {capabilities.gpuMemoryUtil ? (
        <FormField
          asGroup
          label="GPU Memory Utilization"
          description={
            capabilities.backend === "sglang" ? "Maps to SGLang --mem-fraction-static." : undefined
          }
        >
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
      ) : null}
      {capabilities.visibleDevices ? (
        <FormField label="Visible Devices">
          <Input
            value={recipe.visible_devices ?? recipe.cuda_visible_devices ?? ""}
            onChange={(event) =>
              onChange({
                ...recipe,
                visible_devices: event.target.value || undefined,
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

function Memory({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.memoryManagement) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Database className="h-4 w-4" />} title="Memory Management">
      <div className="grid grid-cols-3 gap-3">
        {field.input("swap_space", "Swap Space (GB)", { type: "number", placeholder: "0" })}
        {field.input("cpu_offload_gb", "CPU Offload (GB)", {
          type: "number",
          placeholder: "0",
        })}
        {field.input("num_gpu_blocks_override", "GPU Blocks Override", {
          type: "number",
          placeholder: "Auto",
        })}
      </div>
    </FormSection>
  );
}

function KvCache({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.kvCacheDtype && !capabilities.blockSize && !capabilities.caching) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Database className="h-4 w-4" />} title="KV Cache & Memory">
      <div className="grid grid-cols-2 gap-3">
        {capabilities.kvCacheDtype
          ? field.choices(
              "kv_cache_dtype",
              "KV Cache Dtype",
              { auto: "Auto", fp8: "FP8", fp8_e5m2: "FP8 E5M2", fp8_e4m3: "FP8 E4M3" },
              { fallback: "auto", empty: "auto" },
            )
          : null}
        {capabilities.blockSize
          ? field.choices(
              "block_size",
              "Block Size",
              { "8": "8", "16": "16", "32": "32" },
              { fallback: "16", numeric: true, zeroIsEmpty: true },
            )
          : null}
      </div>
      {capabilities.caching ? (
        <div className="grid grid-cols-2 gap-3">
          {field.checkbox("enable_prefix_caching", "Prefix Caching", "Cache shared prefixes")}
          {field.checkbox("enable_chunked_prefill", "Chunked Prefill", "Interleave prefill/decode")}
        </div>
      ) : null}
    </FormSection>
  );
}

function Scheduler({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.maxNumSeqs && !capabilities.schedulerAdvanced) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Clock className="h-4 w-4" />} title="Scheduler & Batching">
      <div className="grid grid-cols-3 gap-3">
        {capabilities.maxNumSeqs
          ? field.input("max_num_seqs", "Max Sequences", {
              type: "number",
              placeholder: "256",
              description: capabilities.backend === "sglang" ? "--max-running-requests" : undefined,
            })
          : null}
        {capabilities.schedulerAdvanced ? (
          <>
            {field.input("max_num_batched_tokens", "Max Batched Tokens", {
              type: "number",
              placeholder: "Auto",
            })}
            {field.input("max_paddings", "Max Paddings", { type: "number", placeholder: "Auto" })}
          </>
        ) : null}
      </div>
      {capabilities.schedulerAdvanced
        ? field.choices("scheduling_policy", "Scheduling Policy", {
            "": "Default",
            fcfs: "FCFS (First Come First Serve)",
            priority: "Priority",
          })
        : null}
    </FormSection>
  );
}

function Compilation({ recipe, onChange }: SectionProps) {
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Zap className="h-4 w-4" />} title="CUDA Graphs & Compilation">
      <div className="grid grid-cols-2 gap-3">
        {field.checkbox("use_v2_block_manager", "v2 Block Manager", "New memory management")}
        {field.checkbox(
          "disable_custom_all_reduce",
          "Disable Custom AllReduce",
          "Use default NCCL collectives",
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field.input("cuda_graph_max_bs", "CUDA Graph Max Batch Size", {
          type: "number",
          placeholder: "Default",
        })}
        {field.input("compilation_config", "Compilation Config", {
          placeholder: `e.g., {"level": 3}`,
        })}
      </div>
    </FormSection>
  );
}

function ModelInput({ recipe, onChange }: SectionProps) {
  const mode = visionModeForRecipe(recipe);
  return (
    <FormSection icon={<Eye className="h-4 w-4" />} title="Model Input">
      <FormField label="Image input" description={VISION_DESCRIPTIONS[mode]} asGroup>
        <SegmentedControl
          items={[...VISION_MODES]}
          value={mode}
          onChange={(value) => onChange({ ...recipe, vision: visionForMode(value) })}
          size="sm"
        />
      </FormField>
    </FormSection>
  );
}

function ToolCalling({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.toolCalling) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Wrench className="h-4 w-4" />} title="Tool Calling">
      {field.choices("tool_call_parser", "Tool Call Parser", {
        "": "None",
        General: { hermes: "Hermes", pythonic: "Pythonic", openai: "OpenAI" },
        Llama: {
          llama3_json: "Llama 3 JSON",
          llama4_json: "Llama 4 JSON",
          llama4_pythonic: "Llama 4 Pythonic",
        },
        DeepSeek: {
          deepseek_v3: "DeepSeek V3",
          deepseek_v31: "DeepSeek V3.1",
          deepseek_v32: "DeepSeek V3.2",
        },
        Qwen: { qwen3_xml: "Qwen3 XML", qwen3_coder: "Qwen3 Coder" },
        GLM: { glm45: "GLM-4.5", glm47: "GLM-4.7" },
        Other: { mistral: "Mistral", granite: "Granite", minimax: "MiniMax", kimi_k2: "Kimi K2" },
      })}
      {capabilities.backend === "vllm" ? (
        <>
          {field.input("tool_parser_plugin", "Tool Parser Plugin", {
            placeholder: "Path to custom parser module",
          })}
          {field.checkbox(
            "enable_auto_tool_choice",
            "Enable Auto Tool Choice",
            "Automatically decide when to use tools",
          )}
        </>
      ) : null}
    </FormSection>
  );
}

function Reasoning({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.reasoning) return null;
  const field = createRecipeFields(recipe, onChange);
  return (
    <FormSection icon={<Brain className="h-4 w-4" />} title="Reasoning & Thinking">
      {field.choices("reasoning_parser", "Reasoning Parser", {
        "": "None",
        DeepSeek: { deepseek_r1: "DeepSeek R1", deepseek_v3: "DeepSeek V3" },
        Others: { qwen3: "Qwen3", glm45: "GLM-4.5", granite: "Granite" },
      })}
      {capabilities.backend === "vllm" ? (
        <>
          {field.input("guided_decoding_backend", "Guided Decoding Backend", {
            placeholder: "e.g., xgrammar, outlines",
          })}
          {field.checkbox(
            "enable_thinking",
            "Enable Thinking Mode",
            "Show the model's thinking process",
          )}
          {recipe.enable_thinking
            ? field.input("thinking_budget", "Thinking Budget (tokens)", {
                type: "number",
                placeholder: "1024",
              })
            : null}
        </>
      ) : null}
    </FormSection>
  );
}

function ChatTemplates({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.chatTemplates) return null;
  const field = createRecipeFields(recipe, onChange);
  const vllm = capabilities.backend === "vllm";
  return (
    <FormSection icon={<MessageSquare className="h-4 w-4" />} title="Chat & Templates">
      <div className={vllm ? "grid grid-cols-2 gap-3" : undefined}>
        {field.input("chat_template", "Chat Template", { placeholder: "Path or name" })}
        {vllm ? field.input("response_role", "Response Role", { placeholder: "assistant" }) : null}
      </div>
      {vllm
        ? field.choices(
            "chat_template_content_format",
            "Chat Template Format",
            { auto: "Auto", string: "String", openai: "OpenAI" },
            { fallback: "auto", empty: "auto" },
          )
        : null}
    </FormSection>
  );
}

const TAB_SECTIONS: Record<OptionTabId, readonly Section[]> = {
  model: [Context, Weights],
  resources: [Parallelism, Gpu, Memory],
  performance: [
    (props) => (props.capabilities.cudaGraphs ? <Compilation {...props} /> : null),
    KvCache,
    Scheduler,
  ],
  features: [ModelInput, ToolCalling, Reasoning, ChatTemplates],
};

const OPTION_TITLES: Record<OptionTabId, string> = {
  model: "Model Options",
  resources: "Resource Options",
  performance: "Performance Options",
  features: "Sampling & Features",
};

export function RecipeModalOptionTab({
  tab,
  ...props
}: RecipeModalTabProps & { tab: OptionTabId }) {
  return (
    <div className="space-y-6">
      {TAB_SECTIONS[tab].map((Section, index) => (
        <Section key={index} {...props} />
      ))}
    </div>
  );
}
