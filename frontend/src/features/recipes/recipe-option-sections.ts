import {
  Boxes,
  Brain,
  Clock,
  Cpu,
  Database,
  Eye,
  GitBranch,
  Layers,
  type LucideIcon,
  MessageSquare,
  Wrench,
  Zap,
} from "@/ui/icon-registry";
import type { Backend } from "@/lib/types";
import type { LlamacppOption } from "./llamacpp-options";
import type { RecipeEditor } from "./recipe-editor";
import type { RecipeModalTabId } from "./recipe-modal/tabs/tab-id";

/** A literal value, or one that differs per engine backend. */
export type ByBackend<T> = T | Partial<Record<Backend, T>>;

export const forBackend = <T>(value: ByBackend<T> | undefined, backend: Backend): T | undefined =>
  typeof value === "object" ? (value as Partial<Record<Backend, T>>)[backend] : value;

type SelectChoices = Readonly<Record<string, string | Readonly<Record<string, string>>>>;
type Key = keyof RecipeEditor;

type FieldBase = {
  label: string;
  /** Engines that render this field; omit to render it for every engine with the section. */
  backends?: readonly Backend[];
  /** Render only while this recipe key holds a truthy value. */
  visibleWhen?: Key;
  /** Span the whole section width instead of a single grid column. */
  full?: boolean;
  description?: ByBackend<string>;
};

type InputField = FieldBase & {
  kind: "text" | "number";
  name: Key;
  placeholder?: ByBackend<string>;
  min?: number;
};
type ChoiceField = FieldBase & {
  kind: "choices";
  name: Key;
  choices: SelectChoices;
  fallback?: string;
  empty?: string;
  numeric?: boolean;
  zeroIsEmpty?: boolean;
};
type CheckField = FieldBase & { kind: "checkbox"; name: Key };

/**
 * One editor control. The first three kinds cover plain recipe keys; the rest
 * are escape hatches for widgets that cannot be described by a key and a label.
 */
export type RecipeField =
  | InputField
  | ChoiceField
  | CheckField
  /** Number written to every key at once (`tp` and `tensor_parallel_size`). */
  | (FieldBase & { kind: "parallel-size"; keys: readonly Key[] })
  /** Text written to the first key, clearing the legacy aliases behind it. */
  | (FieldBase & { kind: "device-list"; keys: readonly Key[]; placeholder: string })
  | (FieldBase & { kind: "gpu-memory" })
  | (FieldBase & { kind: "vision" })
  /** An engine-native flag stored verbatim in `extra_args`. */
  | (FieldBase & { kind: "engine-option"; option: LlamacppOption });

/** Fields flow into one `cols`-wide grid; `full` fields span every column. */
export type RecipeSection = {
  icon: LucideIcon;
  title: string;
  cols: 1 | 2 | 3;
  fields: RecipeField[];
};

export type OptionTabId = Extract<
  RecipeModalTabId,
  "model" | "resources" | "performance" | "features"
>;

type Extra<F extends RecipeField> = Partial<Omit<F, "kind" | "name" | "label" | "choices">>;

const text = (name: Key, label: string, extra: Extra<InputField> = {}): InputField => ({
  ...extra,
  kind: "text",
  name,
  label,
});
const num = (name: Key, label: string, extra: Extra<InputField> = {}): InputField => ({
  ...extra,
  kind: "number",
  name,
  label,
});
const pick = (
  name: Key,
  label: string,
  choices: SelectChoices,
  extra: Extra<ChoiceField> = {},
): ChoiceField => ({ ...extra, kind: "choices", name, label, choices });
const check = (
  name: Key,
  label: string,
  description: string,
  extra: Extra<CheckField> = {},
): CheckField => ({ ...extra, kind: "checkbox", name, label, description });

const TENSOR = ["vllm", "sglang"] as const;
const VLLM = ["vllm"] as const;
const AUTO = { fallback: "auto", empty: "auto" } as const;
const WIDE = { full: true } as const;

export const RECIPE_SECTIONS = {
  context: {
    icon: Layers,
    title: "Model & Context",
    cols: 2,
    fields: [
      num("max_model_len", "Context Length", {
        placeholder: { vllm: "32768", sglang: "32768", llamacpp: "8192", mlx: "32768" },
      }),
      num("seed", "Seed", { placeholder: "Random" }),
    ],
  },
  weights: {
    icon: Boxes,
    title: "Weights & Quantization",
    cols: 2,
    fields: [
      text("tokenizer", "Tokenizer", { placeholder: "Path or name", backends: TENSOR }),
      pick(
        "tokenizer_mode",
        "Tokenizer Mode",
        { auto: "Auto", slow: "Slow", mistral: "Mistral" },
        { ...AUTO, backends: TENSOR },
      ),
      text("revision", "Revision", { placeholder: "e.g., main", backends: TENSOR }),
      text("load_format", "Load Format", { placeholder: "auto, safetensors", backends: TENSOR }),
      text("quantization_param_path", "Quantization Param Path", {
        placeholder: "Path to calibration file",
        backends: TENSOR,
        full: true,
      }),
      text("quantization", "Quantization", { placeholder: "awq, gptq, fp8", backends: TENSOR }),
      pick(
        "dtype",
        "Dtype",
        { auto: "Auto", float16: "float16", bfloat16: "bfloat16", float32: "float32" },
        { ...AUTO, backends: TENSOR },
      ),
      check(
        "trust_remote_code",
        "Trust Remote Code",
        "Allow the model repo to execute custom modeling code.",
        WIDE,
      ),
    ],
  },
  parallelism: {
    icon: GitBranch,
    title: "Parallelism",
    cols: 3,
    fields: [
      { kind: "parallel-size", label: "Tensor Parallel", keys: ["tp", "tensor_parallel_size"] },
      { kind: "parallel-size", label: "Pipeline Parallel", keys: ["pp", "pipeline_parallel_size"] },
      num("data_parallel_size", "Data Parallel", { min: 1, placeholder: "1" }),
      check(
        "enable_expert_parallel",
        "Expert Parallel (MoE)",
        "Shard MoE experts across the parallel group.",
        WIDE,
      ),
    ],
  },
  gpu: {
    icon: Cpu,
    title: "GPU",
    cols: 1,
    fields: [
      {
        kind: "gpu-memory",
        label: "GPU Memory Utilization",
        description: { sglang: "Maps to SGLang --mem-fraction-static." },
      },
      {
        kind: "device-list",
        label: "Visible Devices",
        keys: ["visible_devices", "cuda_visible_devices"],
        placeholder: "0,1,2,3 or all",
      },
    ],
  },
  memory: {
    icon: Database,
    title: "Memory Management",
    cols: 3,
    fields: [
      num("swap_space", "Swap Space (GB)", { placeholder: "0" }),
      num("cpu_offload_gb", "CPU Offload (GB)", { placeholder: "0" }),
      num("num_gpu_blocks_override", "GPU Blocks Override", { placeholder: "Auto" }),
    ],
  },
  compilation: {
    icon: Zap,
    title: "CUDA Graphs & Compilation",
    cols: 2,
    fields: [
      check("use_v2_block_manager", "v2 Block Manager", "New memory management"),
      check(
        "disable_custom_all_reduce",
        "Disable Custom AllReduce",
        "Use default NCCL collectives",
      ),
      num("cuda_graph_max_bs", "CUDA Graph Max Batch Size", { placeholder: "Default" }),
      text("compilation_config", "Compilation Config", { placeholder: `e.g., {"level": 3}` }),
    ],
  },
  kvCache: {
    icon: Database,
    title: "KV Cache & Memory",
    cols: 2,
    fields: [
      pick(
        "kv_cache_dtype",
        "KV Cache Dtype",
        { auto: "Auto", fp8: "FP8", fp8_e5m2: "FP8 E5M2", fp8_e4m3: "FP8 E4M3" },
        AUTO,
      ),
      pick(
        "block_size",
        "Block Size",
        { "8": "8", "16": "16", "32": "32" },
        { fallback: "16", numeric: true, zeroIsEmpty: true },
      ),
      check("enable_prefix_caching", "Prefix Caching", "Cache shared prefixes"),
      check("enable_chunked_prefill", "Chunked Prefill", "Interleave prefill/decode"),
    ],
  },
  scheduler: {
    icon: Clock,
    title: "Scheduler & Batching",
    cols: 3,
    fields: [
      num("max_num_seqs", "Max Sequences", {
        placeholder: "256",
        description: { sglang: "--max-running-requests" },
      }),
      num("max_num_batched_tokens", "Max Batched Tokens", { placeholder: "Auto" }),
      num("max_paddings", "Max Paddings", { placeholder: "Auto" }),
      pick(
        "scheduling_policy",
        "Scheduling Policy",
        { "": "Default", fcfs: "FCFS (First Come First Serve)", priority: "Priority" },
        WIDE,
      ),
    ],
  },
  modelInput: {
    icon: Eye,
    title: "Model Input",
    cols: 1,
    fields: [{ kind: "vision", label: "Image input" }],
  },
  toolCalling: {
    icon: Wrench,
    title: "Tool Calling",
    cols: 1,
    fields: [
      pick("tool_call_parser", "Tool Call Parser", {
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
      }),
      text("tool_parser_plugin", "Tool Parser Plugin", {
        placeholder: "Path to custom parser module",
        backends: VLLM,
      }),
      check(
        "enable_auto_tool_choice",
        "Enable Auto Tool Choice",
        "Automatically decide when to use tools",
        { backends: VLLM },
      ),
    ],
  },
  reasoning: {
    icon: Brain,
    title: "Reasoning & Thinking",
    cols: 1,
    fields: [
      pick("reasoning_parser", "Reasoning Parser", {
        "": "None",
        DeepSeek: { deepseek_r1: "DeepSeek R1", deepseek_v3: "DeepSeek V3" },
        Others: { qwen3: "Qwen3", glm45: "GLM-4.5", granite: "Granite" },
      }),
      text("guided_decoding_backend", "Guided Decoding Backend", {
        placeholder: "e.g., xgrammar, outlines",
        backends: VLLM,
      }),
      check("enable_thinking", "Enable Thinking Mode", "Show the model's thinking process", {
        backends: VLLM,
      }),
      num("thinking_budget", "Thinking Budget (tokens)", {
        placeholder: "1024",
        backends: VLLM,
        visibleWhen: "enable_thinking",
      }),
    ],
  },
  chatTemplates: {
    icon: MessageSquare,
    title: "Chat & Templates",
    cols: 2,
    fields: [
      text("chat_template", "Chat Template", { placeholder: "Path or name" }),
      text("response_role", "Response Role", { placeholder: "assistant", backends: VLLM }),
      pick(
        "chat_template_content_format",
        "Chat Template Format",
        { auto: "Auto", string: "String", openai: "OpenAI" },
        { ...AUTO, backends: VLLM, full: true },
      ),
    ],
  },
} satisfies Record<string, RecipeSection>;

export type RecipeSectionId = keyof typeof RECIPE_SECTIONS;
