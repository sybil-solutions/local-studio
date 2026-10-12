import type { StudioStarterPreset } from "./types";

/**
 * First-run presets shown when a controller has no recipes yet. Three lanes:
 * a serious local model, a small fast local model, and a remote endpoint —
 * so every machine (and no machine at all) has a working first chat.
 */
export const STUDIO_STARTER_PRESETS: StudioStarterPreset[] = [
  {
    id: "qwen3-6-35b",
    name: "Qwen3.6 35B",
    description:
      "Hybrid MoE in native FP4 — frontier-class local chat, tool use, and reasoning on a single Blackwell GPU.",
    kind: "download",
    tags: ["local", "reasoning", "tool-use", "recommended"],
    size_gb: 20,
    min_vram_gb: 24,
    model_id: "nvidia/Qwen3.6-35B-A3B-NVFP4",
    backend: "vllm",
    recipe_overrides: {
      served_model_name: "qwen3.6-35b",
      max_model_len: 131072,
      tool_call_parser: "qwen3_coder",
      reasoning_parser: "qwen3",
      enable_auto_tool_choice: true,
      trust_remote_code: true,
    },
  },
  {
    id: "qwen3-4b",
    name: "Qwen3 4B",
    description:
      "A ~8 GB download that runs fast on any modern GPU — solid chat and tool use for modest hardware.",
    kind: "download",
    tags: ["local", "fast", "small"],
    size_gb: 8,
    min_vram_gb: 10,
    model_id: "Qwen/Qwen3-4B-Instruct-2507",
    backend: "vllm",
    recipe_overrides: {
      served_model_name: "qwen3-4b",
      max_model_len: 32768,
      tool_call_parser: "qwen3_coder",
      enable_auto_tool_choice: true,
    },
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    description:
      "Connect a hosted endpoint with one API key — full-strength chat with nothing to download.",
    kind: "remote",
    tags: ["remote", "instant"],
    size_gb: null,
    min_vram_gb: null,
    remote: {
      base_url: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    },
  },
];
