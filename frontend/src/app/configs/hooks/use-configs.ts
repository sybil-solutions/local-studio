"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import api from "@/lib/api";
import { createApiClient } from "@/lib/api/create-api-client";
import { getApiKey, setApiKey, clearApiKey } from "@/lib/api-key";
import { resolveSettingsDefaultBackendUrl } from "@/lib/backend-config";
import { getStoredBackendUrl, setStoredBackendUrl, clearStoredBackendUrl } from "@/lib/backend-url";
import { normalizeControllerUrl } from "@/lib/controllers";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "@/lib/configs/types";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const CONNECTION_TEST_REQUEST = { timeout: 10_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 20_000, retries: 0 } as const;
const FAST_CONFIG_REQUEST = { timeout: 20_000, retries: 0 } as const;

const DEFAULT_BACKEND_URL = resolveSettingsDefaultBackendUrl();

const DEFAULT_API_SETTINGS: ApiConnectionSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: "",
  hasApiKey: false,
  voiceUrl: "",
  voiceModel: "whisper-large-v3-turbo",
};

const mergeApiSettings = (
  server?: Partial<ApiConnectionSettings>,
  current?: ApiConnectionSettings,
): ApiConnectionSettings => {
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
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const [apiSettings, setApiSettings] = useState<ApiConnectionSettings>(DEFAULT_API_SETTINGS);
  const [apiSettingsLoading, setApiSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("unknown");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const loadApiSettings = useCallback(async () => {
    try {
      setApiSettingsLoading(true);
      const res = await fetch("/api/settings");
      if (res.ok) {
        const settings = (await res.json()) as Partial<ApiConnectionSettings>;
        setApiSettings((previous) => mergeApiSettings(settings, previous));
        return;
      }
    } catch (e) {
      console.error("Failed to load API settings:", e);
    } finally {
      setApiSettingsLoading(false);
    }
    setApiSettings((previous) => mergeApiSettings(undefined, previous));
  }, []);

  const persistLocalApiSettings = useCallback(() => {
    const backendUrl = normalizeControllerUrl(apiSettings.backendUrl ?? "");
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
    scheduleDurableUiPreferencesSave();
  }, [apiSettings]);

  const testConnection = useCallback(async () => {
    try {
      setTesting(true);
      setConnectionStatus("unknown");
      setStatusMessage("Testing...");

      const baseUrl = normalizeControllerUrl(apiSettings.backendUrl ?? "");
      if (!baseUrl) {
        setConnectionStatus("error");
        setStatusMessage("Missing API URL");
        return;
      }

      const apiKey = apiSettings.apiKey?.includes("••••") ? "" : apiSettings.apiKey;
      const probe = createApiClient({
        baseUrl: "/api/proxy",
        useProxy: true,
        backendUrlOverride: baseUrl,
        apiKeyOverride: apiKey,
      });
      await probe.getStatus(CONNECTION_TEST_REQUEST);
      setConnectionStatus("connected");
      setStatusMessage("Connected");
    } catch (e) {
      setConnectionStatus("error");
      setStatusMessage((e as Error).message || "Connection failed");
    } finally {
      setTesting(false);
    }
  }, [apiSettings.apiKey, apiSettings.backendUrl]);

  const checkBackendHealth = useCallback(async () => {
    try {
      await api.getStatus(FAST_STATUS_REQUEST);
      setBackendOnline(true);
      return true;
    } catch {
      setBackendOnline(false);
      return false;
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [configResult, compatibilityResult] = await Promise.allSettled([
        api.getSystemConfig(FAST_CONFIG_REQUEST),
        api.getCompatibility(FAST_COMPAT_REQUEST),
      ]);

      if (configResult.status !== "fulfilled") {
        throw configResult.reason;
      }

      const configData = configResult.value;
      const compatibility =
        compatibilityResult.status === "fulfilled" ? compatibilityResult.value : null;
      setData(configData);
      setCompatibilityReport(compatibility);
      setBackendOnline(true);
      if (typeof window !== "undefined" && !localStorage.getItem("vllm-studio-setup-complete")) {
        localStorage.setItem("vllm-studio-setup-complete", "true");
      }
    } catch (e) {
      setError((e as Error).message);
      await checkBackendHealth();
    } finally {
      setLoading(false);
    }
  }, [checkBackendHealth]);

  const saveApiSettings = useCallback(async () => {
    const backendUrl = normalizeControllerUrl(apiSettings.backendUrl ?? "");
    persistLocalApiSettings();

    let savedRemotely = false;
    try {
      setSaving(true);
      setStatusMessage("");
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backendUrl,
          apiKey: apiSettings.apiKey,
          voiceUrl: apiSettings.voiceUrl,
          voiceModel: apiSettings.voiceModel,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Partial<ApiConnectionSettings>;
        setApiSettings((previous) => mergeApiSettings(updated, previous));
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

    if (savedRemotely) {
      setStatusMessage("Settings saved");
    }

    // Always attempt to refresh config when a backend URL is present.
    if (backendUrl) {
      loadConfig();
    }

    // Avoid showing a hard error when only the server-side save failed.
    if (!savedRemotely) {
      setConnectionStatus("unknown");
    }
  }, [apiSettings, loadConfig, persistLocalApiSettings]);

  const subscribeConfigLoad = useCallback(
    (_notify: () => void) => {
      void loadConfig();
      void loadApiSettings();
      return () => {};
    },
    [loadApiSettings, loadConfig],
  );

  useSyncExternalStore(subscribeConfigLoad, getConfigsSnapshot, getConfigsSnapshot);

  return {
    data,
    compatibilityReport,
    loading,
    error,
    apiSettings,
    apiSettingsLoading,
    saving,
    testing,
    connectionStatus,
    statusMessage,
    setApiSettings,
    loadConfig,
    saveApiSettings,
    testConnection,
    hasConfigData: Boolean(data),
    isInitialLoading: loading && !data,
    backendOnline,
  };
}

const getConfigsSnapshot = (): number => 0;
