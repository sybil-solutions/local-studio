// CRITICAL
import type {
  AgentFileEntry,
  AgentFileVersion,
  AgentState,
  ChatCompactionResponse,
  ChatSession,
  ChatSessionDetail,
  StoredMessage,
} from "../types";
import type { ApiCore } from "./core";
import { encodePathSegments } from "./core";

export function createChatsApi(core: ApiCore) {
  return {
    streamChatRun: (
      sessionId: string,
      payload: {
        content: string;
        message_id?: string;
        model?: string;
        provider?: string;
        system?: string;
        mcp_enabled?: boolean;
        agent_mode?: boolean;
        agent_files?: boolean;
        deep_research?: boolean;
        thinking_level?: string;
      },
      options: { signal?: AbortSignal } = {},
    ) => core.postSseJson(`/chats/${encodeURIComponent(sessionId)}/turn`, payload, options),

    getChatSessions: async (): Promise<{ sessions: ChatSession[] }> => {
      const data = await core.request<ChatSession[]>("/chats");
      return { sessions: Array.isArray(data) ? data : [] };
    },

    getChatSession: (id: string): Promise<{ session: ChatSessionDetail }> =>
      core.request(`/chats/${id}`),

    createChatSession: (data: {
      title?: string;
      model?: string;
      agent_state?: AgentState | null;
    }): Promise<{ session: ChatSessionDetail }> =>
      core.request("/chats", { method: "POST", body: JSON.stringify(data) }),

    updateChatSession: (
      id: string,
      data: { title?: string; model?: string; agent_state?: AgentState | null },
    ): Promise<void> => core.request(`/chats/${id}`, { method: "PUT", body: JSON.stringify(data) }),

    deleteChatSession: (id: string): Promise<void> =>
      core.request(`/chats/${id}`, { method: "DELETE" }),

    forkChatSession: (
      id: string,
      data: { message_id?: string; model?: string; title?: string },
    ): Promise<{ session: ChatSessionDetail }> =>
      core.request(`/chats/${id}/fork`, { method: "POST", body: JSON.stringify(data) }),

    compactChatSession: (
      id: string,
      data: {
        model?: string;
        system?: string;
        title?: string;
        preserve_first?: boolean;
        preserve_last?: boolean;
      },
    ): Promise<ChatCompactionResponse> =>
      core.request(`/chats/${id}/compact`, { method: "POST", body: JSON.stringify(data) }),

    addChatMessage: (sessionId: string, message: StoredMessage): Promise<StoredMessage> =>
      core.request(`/chats/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify(message),
      }),

    abortChatRun: async (
      sessionId: string,
      runId: string,
    ): Promise<{ success: boolean }> => {
      try {
        return await core.request(`/chats/${sessionId}/runs/${runId}/abort`, { method: "POST" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Run not found") || message.includes("HTTP 404")) {
          return { success: false };
        }
        throw error;
      }
    },

    getChatUsage: (sessionId: string): Promise<{
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd?: number;
    }> => core.request(`/chats/${sessionId}/usage`),

    getAgentFiles: (
      sessionId: string,
      options?: { path?: string; recursive?: boolean },
    ): Promise<{ files: AgentFileEntry[]; path?: string }> => {
      const params = new URLSearchParams();
      if (options?.path) params.set("path", options.path);
      if (options?.recursive === false) params.set("recursive", "false");
      const query = params.toString();
      return core.request(`/chats/${sessionId}/files${query ? `?${query}` : ""}`);
    },

    readAgentFile: (sessionId: string, path: string): Promise<{ path: string; content: string }> =>
      core.request(`/chats/${sessionId}/files/${encodePathSegments(path)}`),

    readAgentFileWithVersions: (
      sessionId: string,
      path: string,
    ): Promise<{ path: string; content: string; versions?: AgentFileVersion[] }> =>
      core.request(`/chats/${sessionId}/files/${encodePathSegments(path)}?versions=true`),

    writeAgentFile: (
      sessionId: string,
      path: string,
      data: { content: string; encoding?: "utf8" | "base64" },
    ): Promise<{ success: boolean }> => {
      if (!path || path.trim() === "") throw new Error("Path is required");
      return core.request(`/chats/${sessionId}/files/${encodePathSegments(path)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },

    deleteAgentFile: (sessionId: string, path: string): Promise<{ success: boolean }> =>
      core.request(`/chats/${sessionId}/files/${encodePathSegments(path)}`, { method: "DELETE" }),

    createAgentDirectory: (sessionId: string, path: string): Promise<{ success: boolean }> =>
      core.request(`/chats/${sessionId}/files/dir`, {
        method: "POST",
        body: JSON.stringify({ path }),
      }),

    moveAgentFile: (sessionId: string, from: string, to: string): Promise<{ success: boolean }> =>
      core.request(`/chats/${sessionId}/files/move`, {
        method: "POST",
        body: JSON.stringify({ from, to }),
      }),
  };
}
