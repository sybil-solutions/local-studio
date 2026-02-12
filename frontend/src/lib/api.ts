// CRITICAL
/**
 * API client for vLLM Studio Controller.
 *
 * Keep this file small: implementation lives under `frontend/src/lib/api/`.
 */

import { createApiClient } from "./api/create-api-client";
import { resolveApiServerBaseUrl } from "./backend-config";
export type { ChatRunStreamEvent } from "./api/core";

// For client-side calls, use the proxy which handles authentication
// The proxy adds the API key server-side, avoiding CORS and auth issues
const isClient = typeof window !== "undefined";
const clientBaseUrl = isClient
  ? "/api/proxy"
  : resolveApiServerBaseUrl();

const api = createApiClient({ baseUrl: clientBaseUrl, useProxy: isClient });
export default api;
