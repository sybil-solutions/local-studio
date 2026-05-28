import type { LlamacppOption } from "./types";

export const LLAMACPP_OPTIONS_PART_1B: LlamacppOption[] = [
  {
    key: "gpu-layers",
    label: "GPU Layers",
    type: "number",
    tab: "resources",
    placeholder: "99",
  },
  {
    key: "gpu-layers-draft",
    label: "GPU Layers (Draft)",
    type: "number",
    tab: "resources",
  },
  {
    key: "split-mode",
    label: "Split Mode",
    type: "select",
    tab: "resources",
    options: ["none", "layer", "row"],
  },
  {
    key: "tensor-split",
    label: "Tensor Split",
    type: "text",
    tab: "resources",
    placeholder: "1,1,1,1",
  },
  {
    key: "main-gpu",
    label: "Main GPU",
    type: "number",
    tab: "resources",
  },
  {
    key: "cache-type-k",
    label: "KV Cache Type (K)",
    type: "select",
    tab: "resources",
    options: ["f16", "q8_0", "q4_0", "q6_K"],
  },
  {
    key: "cache-type-v",
    label: "KV Cache Type (V)",
    type: "select",
    tab: "resources",
    options: ["f16", "q8_0", "q4_0", "q6_K"],
  },
  {
    key: "cache-type-k-draft",
    label: "KV Cache Type K (Draft)",
    type: "select",
    tab: "resources",
    options: ["f16", "q8_0", "q4_0", "q6_K"],
  },
  {
    key: "cache-type-v-draft",
    label: "KV Cache Type V (Draft)",
    type: "select",
    tab: "resources",
    options: ["f16", "q8_0", "q4_0", "q6_K"],
  },
  {
    key: "no-kv-offload",
    label: "Disable KV Offload",
    type: "boolean",
    tab: "resources",
  },
  {
    key: "no-mmap",
    label: "Disable mmap",
    type: "boolean",
    tab: "resources",
  },
  {
    key: "mlock",
    label: "Lock Memory",
    type: "boolean",
    tab: "resources",
  },
  {
    key: "numa",
    label: "NUMA",
    type: "boolean",
    tab: "resources",
  },
];
