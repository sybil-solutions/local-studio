// CRITICAL
export const CONTROLLER_EVENTS = {
  STATUS: "status",
  GPU: "gpu",
  METRICS: "metrics",
  RUNTIME_SUMMARY: "runtime_summary",
  LAUNCH_PROGRESS: "launch_progress",
  MODEL_SWITCH: "model_switch",
  DOWNLOAD_PROGRESS: "download_progress",
  DOWNLOAD_STATE: "download_state",
  RECIPE_CREATED: "recipe_created",
  RECIPE_UPDATED: "recipe_updated",
  RECIPE_DELETED: "recipe_deleted",
  MCP_SERVER_CREATED: "mcp_server_created",
  MCP_SERVER_UPDATED: "mcp_server_updated",
  MCP_SERVER_DELETED: "mcp_server_deleted",
  MCP_SERVER_ENABLED: "mcp_server_enabled",
  MCP_SERVER_DISABLED: "mcp_server_disabled",
  MCP_TOOL_CALLED: "mcp_tool_called",
  RUNTIME_VLLM_UPGRADED: "runtime_vllm_upgraded",
  RUNTIME_SGLANG_UPGRADED: "runtime_sglang_upgraded",
  RUNTIME_LLAMACPP_UPGRADED: "runtime_llamacpp_upgraded",
  RUNTIME_CUDA_UPGRADED: "runtime_cuda_upgraded",
  RUNTIME_ROCM_UPGRADED: "runtime_rocm_upgraded",
  JOB_UPDATED: "job_updated",
  LOG: "log",
} as const;

export type ControllerEventType =
  (typeof CONTROLLER_EVENTS)[keyof typeof CONTROLLER_EVENTS];

export const CONTROLLER_STREAM_EVENT_TYPES = [
  CONTROLLER_EVENTS.STATUS,
  CONTROLLER_EVENTS.GPU,
  CONTROLLER_EVENTS.METRICS,
  CONTROLLER_EVENTS.RUNTIME_SUMMARY,
  CONTROLLER_EVENTS.LAUNCH_PROGRESS,
  CONTROLLER_EVENTS.MODEL_SWITCH,
  CONTROLLER_EVENTS.DOWNLOAD_PROGRESS,
  CONTROLLER_EVENTS.DOWNLOAD_STATE,
  CONTROLLER_EVENTS.RECIPE_CREATED,
  CONTROLLER_EVENTS.RECIPE_UPDATED,
  CONTROLLER_EVENTS.RECIPE_DELETED,
  CONTROLLER_EVENTS.MCP_SERVER_CREATED,
  CONTROLLER_EVENTS.MCP_SERVER_UPDATED,
  CONTROLLER_EVENTS.MCP_SERVER_DELETED,
  CONTROLLER_EVENTS.MCP_SERVER_ENABLED,
  CONTROLLER_EVENTS.MCP_SERVER_DISABLED,
  CONTROLLER_EVENTS.MCP_TOOL_CALLED,
  CONTROLLER_EVENTS.RUNTIME_VLLM_UPGRADED,
  CONTROLLER_EVENTS.RUNTIME_SGLANG_UPGRADED,
  CONTROLLER_EVENTS.RUNTIME_LLAMACPP_UPGRADED,
  CONTROLLER_EVENTS.RUNTIME_CUDA_UPGRADED,
  CONTROLLER_EVENTS.RUNTIME_ROCM_UPGRADED,
  CONTROLLER_EVENTS.JOB_UPDATED,
] as const;

export type ControllerStreamEventType =
  (typeof CONTROLLER_STREAM_EVENT_TYPES)[number];

export type ControllerEventDomain =
  | "recipe"
  | "runtime"
  | "controller"
  | "mcp";

const CONTROLLER_EVENT_DOMAIN_MAP: Record<
  ControllerStreamEventType,
  ControllerEventDomain
> = {
  [CONTROLLER_EVENTS.STATUS]: "controller",
  [CONTROLLER_EVENTS.GPU]: "controller",
  [CONTROLLER_EVENTS.METRICS]: "controller",
  [CONTROLLER_EVENTS.RUNTIME_SUMMARY]: "controller",
  [CONTROLLER_EVENTS.LAUNCH_PROGRESS]: "controller",
  [CONTROLLER_EVENTS.MODEL_SWITCH]: "controller",
  [CONTROLLER_EVENTS.DOWNLOAD_PROGRESS]: "controller",
  [CONTROLLER_EVENTS.DOWNLOAD_STATE]: "controller",
  [CONTROLLER_EVENTS.RECIPE_CREATED]: "recipe",
  [CONTROLLER_EVENTS.RECIPE_UPDATED]: "recipe",
  [CONTROLLER_EVENTS.RECIPE_DELETED]: "recipe",
  [CONTROLLER_EVENTS.MCP_SERVER_CREATED]: "mcp",
  [CONTROLLER_EVENTS.MCP_SERVER_UPDATED]: "mcp",
  [CONTROLLER_EVENTS.MCP_SERVER_DELETED]: "mcp",
  [CONTROLLER_EVENTS.MCP_SERVER_ENABLED]: "mcp",
  [CONTROLLER_EVENTS.MCP_SERVER_DISABLED]: "mcp",
  [CONTROLLER_EVENTS.MCP_TOOL_CALLED]: "mcp",
  [CONTROLLER_EVENTS.RUNTIME_VLLM_UPGRADED]: "runtime",
  [CONTROLLER_EVENTS.RUNTIME_SGLANG_UPGRADED]: "runtime",
  [CONTROLLER_EVENTS.RUNTIME_LLAMACPP_UPGRADED]: "runtime",
  [CONTROLLER_EVENTS.RUNTIME_CUDA_UPGRADED]: "runtime",
  [CONTROLLER_EVENTS.RUNTIME_ROCM_UPGRADED]: "runtime",
  [CONTROLLER_EVENTS.JOB_UPDATED]: "controller",
};

export const CONTROLLER_BROWSER_EVENT_CHANNEL = {
  recipe: "vllm:recipe-event",
  runtime: "vllm:runtime-event",
  controller: "vllm:controller-event",
  mcp: "vllm:controller-event",
} as const;

export type ControllerBrowserEventChannel =
  (typeof CONTROLLER_BROWSER_EVENT_CHANNEL)[ControllerEventDomain];

const CONTROLLER_STREAM_EVENT_SET = new Set<string>(
  CONTROLLER_STREAM_EVENT_TYPES,
);

export const isControllerStreamEventType = (
  eventType: string,
): eventType is ControllerStreamEventType => {
  return CONTROLLER_STREAM_EVENT_SET.has(eventType);
};

export const getControllerEventDomain = (
  eventType: string,
): ControllerEventDomain | null => {
  if (!isControllerStreamEventType(eventType)) {
    return null;
  }
  return CONTROLLER_EVENT_DOMAIN_MAP[eventType];
};

export const getBrowserEventChannelForControllerEvent = (
  eventType: string,
): ControllerBrowserEventChannel | null => {
  const domain = getControllerEventDomain(eventType);
  if (!domain) {
    return null;
  }
  return CONTROLLER_BROWSER_EVENT_CHANNEL[domain];
};
