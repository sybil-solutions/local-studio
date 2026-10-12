//
// Wire types for the provider hub — importable from client components, so
// nothing here may import pi packages or Node builtins. The runtime-side
// implementation lives in provider-hub.ts.
//

export type ProviderAuthType = "oauth" | "api_key";

export type ProviderView = {
  id: string;
  name: string;
  oauth?: { label: string };
  apiKey?: { label: string };
  configured: boolean;
  authSource?: string;
  authLabel?: string;
  credentialType?: ProviderAuthType;
  modelCount: number;
};

export type ProvidersResponse = { providers: ProviderView[] };

export type ProviderLoginPrompt = {
  id: number;
  type: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
};

export type ProviderLoginEventPayload =
  | { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

export type ProviderLoginEvent = { seq: number; event: ProviderLoginEventPayload };

export type ProviderLoginJobStatus = "running" | "success" | "error" | "cancelled";

export type ProviderLoginJobView = {
  jobId: string;
  providerId: string;
  authType: ProviderAuthType;
  status: ProviderLoginJobStatus;
  error?: string;
  events: ProviderLoginEvent[];
  pendingPrompt?: ProviderLoginPrompt;
};

export type ProviderLoginStartResponse = { jobId: string };
