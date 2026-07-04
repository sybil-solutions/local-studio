import { createApiCore } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSystemApi } from "./system";

export function createApiClient(params: {
  baseUrl: string;
  useProxy: boolean;
  backendUrlOverride?: string;
  apiKeyOverride?: string;
}) {
  const core = createApiCore(params);
  return {
    ...createSystemApi(core),
    ...createRecipesApi(core),
    ...createLogsApi(core),
    ...createStudioApi(core),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}
