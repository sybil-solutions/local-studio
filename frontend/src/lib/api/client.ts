/**
 * Default API client singleton for the Local Studio controller.
 */
import { createApiClient } from "./create-api-client";
import { resolveApiServerBaseUrl } from "./connection";

// For client-side calls, use the proxy which handles authentication
// The proxy adds the API key server-side, avoiding CORS and auth issues
const isClient = typeof window !== "undefined";
const clientBaseUrl = isClient ? "/api/proxy" : resolveApiServerBaseUrl();

const api = createApiClient({ baseUrl: clientBaseUrl, useProxy: isClient });
export default api;
