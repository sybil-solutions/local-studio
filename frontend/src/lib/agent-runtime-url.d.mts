export const AGENT_RUNTIME_URL_ERROR: "Agent runtime URL configuration is invalid.";
export const DEFAULT_AGENT_RUNTIME_URL: "http://127.0.0.1:8081";

export type AgentRuntimeUrlDecision =
  | {
      readonly ok: true;
      readonly url: string;
      readonly hostname: string;
      readonly port: string;
    }
  | { readonly ok: false; readonly error: typeof AGENT_RUNTIME_URL_ERROR };

export function resolveAgentRuntimeUrl(value: string | undefined): AgentRuntimeUrlDecision;
