import { createChatsApi } from "./chats";
import { createApiCore } from "./core";
import { createJobsApi } from "./jobs";
import { createLogsApi } from "./logs";
import { createMcpApi } from "./mcp";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSystemApi } from "./system";

export function createApiClient(params: { baseUrl: string; useProxy: boolean }) {
  const core = createApiCore(params);
  return {
    ...createSystemApi(core),
    ...createRecipesApi(core),
    ...createChatsApi(core),
    ...createMcpApi(core),
    ...createLogsApi(core),
    ...createStudioApi(core),
    ...createJobsApi(core),
  };
}
