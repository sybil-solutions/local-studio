import type { LogSession } from "../types";
import type { ApiCore, RequestOptions } from "./core";

export function createLogsApi(core: ApiCore) {
  return {
    getLogSessions: (options?: RequestOptions): Promise<{ sessions: LogSession[] }> =>
      core.request("/logs", options),

    getLogs: (
      sessionId: string,
      limit?: number,
      options?: RequestOptions,
    ): Promise<{ logs: string[] }> => {
      const query = limit ? `?limit=${limit}` : "";
      return core.request(`/logs/${sessionId}${query}`, options);
    },

    deleteLogSession: (sessionId: string): Promise<void> =>
      core.request(`/logs/${sessionId}`, { method: "DELETE" }),
  };
}
