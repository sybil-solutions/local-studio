// CRITICAL
"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/api-key";
import { resolveSettingsDefaultBackendUrl } from "@/lib/backend-config";
import { getStoredBackendUrl, setStoredBackendUrl, clearStoredBackendUrl } from "@/lib/backend-url";
import type { ConfigData } from "@/lib/types";

export interface ApiConnectionSettings {
  backendUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  voiceUrl: string;
  voiceModel: string;
}

export type ConnectionStatus = "unknown" | "connected" | "error";

const DEFAULT_BACKEND_URL = resolveSettingsDefaultBackendUrl();

const DEFAULT_API_SETTINGS: ApiConnectionSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: "",
  hasApiKey: false,
  voiceUrl: "",
  voiceModel: "whisper-large-v3-turbo",
};

const mergeApiSettings = (server?: Partial<ApiConnectionSettings>): ApiConnectionSettings => {
  const localBackendUrl = getStoredBackendUrl();
  const localApiKey = getApiKey();

  return {
    backendUrl: localBackendUrl || server?.backendUrl || DEFAULT_API_SETTINGS.backendUrl,
    apiKey: localApiKey || server?.apiKey || "",
    hasApiKey: Boolean(localApiKey) || Boolean(server?.hasApiKey),
    voiceUrl: server?.voiceUrl || DEFAULT_API_SETTINGS.voiceUrl,
    voiceModel: server?.voiceModel || DEFAULT_API_SETTINGS.voiceModel,
  };
};

export function useConfigs() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const [apiSettings, setApiSettings] = useState<ApiConnectionSettings>(DEFAULT_API_SETTINGS);
  const [apiSettingsLoading, setApiSettingsLoading] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("unknown");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const loadApiSettings = async () => {
    try {
      setApiSettingsLoading(true);
      const res = await fetch("/api/settings");
      if (res.ok) {
        const settings = (await res.json()) as Partial<ApiConnectionSettings>;
        setApiSettings(mergeApiSettings(settings));
        return;
      }
    } catch (e) {
      console.error("Failed to load API settings:", e);
    } finally {
      setApiSettingsLoading(false);
    }
    setApiSettings(mergeApiSettings());
  };

  const persistLocalApiSettings = () => {
    const backendUrl = apiSettings.backendUrl?.trim() || "";
    if (backendUrl) {
      setStoredBackendUrl(backendUrl);
    } else {
      clearStoredBackendUrl();
    }
    const apiKey = apiSettings.apiKey?.trim() || "";
    if (apiKey && !apiKey.includes("••••")) {
      setApiKey(apiKey);
    } else if (!apiKey) {
      clearApiKey();
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setConnectionStatus("unknown");
      setStatusMessage("Testing...");

      const baseUrl = apiSettings.backendUrl?.trim() || "";
      if (!baseUrl) {
        setConnectionStatus("error");
        setStatusMessage("Missing API URL");
        return;
      }
      const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`);
      if (res.ok) {
        setConnectionStatus("connected");
        setStatusMessage("Connected");
      } else {
        setConnectionStatus("error");
        setStatusMessage(`Error: ${res.status}`);
      }
    } catch {
      setConnectionStatus("error");
      setStatusMessage("Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const checkBackendHealth = async () => {
    try {
      const health = await api.getHealth();
      setBackendOnline(health.status === "ok");
      return health.status === "ok";
    } catch {
      setBackendOnline(false);
      return false;
    }
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const configData = await api.getSystemConfig();
      setData(configData);
      setBackendOnline(true);
    } catch (e) {
      setError((e as Error).message);
      // Config failed, but check if backend is actually online
      await checkBackendHealth();
    } finally {
      setLoading(false);
    }
  };

  const saveApiSettings = async () => {
    const backendUrl = apiSettings.backendUrl?.trim() || "";
    persistLocalApiSettings();

    let savedRemotely = false;
    try {
      setSaving(true);
      setStatusMessage("");
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backendUrl: apiSettings.backendUrl,
          apiKey: apiSettings.apiKey,
          voiceUrl: apiSettings.voiceUrl,
          voiceModel: apiSettings.voiceModel,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Partial<ApiConnectionSettings>;
        setApiSettings(mergeApiSettings(updated));
        setStatusMessage("Settings saved");
        savedRemotely = true;
      } else {
        const err = await res.json().catch(() => ({}));
        setStatusMessage(err.error || "Saved locally");
      }
    } catch {
      setStatusMessage("Saved locally");
    } finally {
      setSaving(false);
    }

    // Always attempt to refresh config when a backend URL is present.
    if (backendUrl) {
      loadConfig();
    }

    // Avoid showing a hard error when only the server-side save failed.
    if (!savedRemotely) {
      setConnectionStatus("unknown");
    }
  };

  useEffect(() => {
    loadConfig();
    loadApiSettings();
  }, []);

  return {
    data,
    loading,
    error,
    apiSettings,
    apiSettingsLoading,
    showApiKey,
    saving,
    testing,
    connectionStatus,
    statusMessage,
    setApiSettings,
    setShowApiKey,
    loadConfig,
    saveApiSettings,
    testConnection,
    hasConfigData: Boolean(data),
    isInitialLoading: loading && !data,
    backendOnline,
  };
}
