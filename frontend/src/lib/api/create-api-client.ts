import { createApiCore } from "./core";
import { createJobsApi } from "./jobs";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSystemApi } from "./system";

export function createApiClient(params: { baseUrl: string; useProxy: boolean }) {
  const core = createApiCore(params);
  return {
    ...createSystemApi(core),
    ...createRecipesApi(core),
    ...createLogsApi(core),
    ...createStudioApi(core),
    ...createJobsApi(core),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}
