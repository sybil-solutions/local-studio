import type {
  EngineImagePull,
  EngineImagesInfo,
  EnvironmentPayload,
  EnvironmentWithStatus,
} from "../types";
import { encodePathSegments, type ApiCore } from "./core";

export function createEnvironmentsApi(core: ApiCore) {
  return {
    getEnvironments: async (): Promise<{ environments: EnvironmentWithStatus[] }> => {
      const data = await core.request<EnvironmentWithStatus[]>("/environments");
      return { environments: Array.isArray(data) ? data : [] };
    },

    getEnvironment: (id: string): Promise<EnvironmentWithStatus> =>
      core.request(`/environments/${encodePathSegments(id)}`),

    createEnvironment: (payload: EnvironmentPayload): Promise<EnvironmentWithStatus> =>
      core.request("/environments", { method: "POST", body: JSON.stringify(payload) }),

    deleteEnvironment: (id: string): Promise<{ success: boolean }> =>
      core.request(`/environments/${encodePathSegments(id)}`, { method: "DELETE" }),

    startEnvironment: (id: string): Promise<{ started: boolean; message: string }> =>
      core.request(`/environments/${encodePathSegments(id)}/start`, { method: "POST" }),

    stopEnvironment: (id: string, force = false): Promise<{ stopped: boolean }> =>
      core.request(`/environments/${encodePathSegments(id)}/stop${force ? "?force=1" : ""}`, {
        method: "POST",
      }),

    getEngineImages: (): Promise<EngineImagesInfo[]> => core.request("/environments/images"),

    pullEngineImage: (image: string): Promise<EngineImagePull> =>
      core.request("/environments/images/pull", {
        method: "POST",
        body: JSON.stringify({ image }),
      }),
  };
}
