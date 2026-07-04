export interface ApiConnectionSettings {
  backendUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}

export type ConnectionStatus = "unknown" | "connected" | "error";
