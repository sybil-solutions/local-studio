"use client";

import { useCallback, useRef, useState } from "react";
import api from "@/lib/api/client";
import { createApiClient } from "@/lib/api/create-api-client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  clearApiKey,
  clearStoredBackendUrl,
  getApiKey,
  getStoredBackendUrl,
  resolveSettingsDefaultBackendUrl,
  setApiKey,
  setStoredBackendUrl,
} from "@/lib/api/connection";
import { normalizeControllerUrl } from "@/lib/api/controllers";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";
import type { CompatibilityReport, ConfigData } from "@/lib/types";
import type { ApiConnectionSettings, ConnectionStatus } from "./types";

const FAST_STATUS_REQUEST = { timeout: 5_000, retries: 0 } as const;
const CONNECTION_TEST_REQUEST = { timeout: 10_000, retries: 0 } as const;
const FAST_COMPAT_REQUEST = { timeout: 20_000, retries: 0 } as const;
const FAST_CONFIG_REQUEST = { timeout: 20_000, retries: 0 } as const;

const DEFAULT_BACKEND_URL = resolveSettingsDefaultBackendUrl();

const DEFAULT_API_SETTINGS: ApiConnectionSettings = {
  backendUrl: DEFAULT_BACKEND_URL,
  apiKey: "",
  hasApiKey: false,
};

const mergeApiSettings = (server?: Partial<ApiConnectionSettings>): ApiConnectionSettings => {
  const localBackendUrl = getStoredBackendUrl();
  const localApiKey = getApiKey();

  return {
    backendUrl: localBackendUrl || server?.backendUrl || DEFAULT_API_SETTINGS.backendUrl,
    apiKey: localApiKey || server?.apiKey || "",
    hasApiKey: Boolean(localApiKey) || Boolean(server?.hasApiKey),
  };
};

export function useSettings() {
  // Stale-while-revalidate: seed from the last-loaded config so navigating to
  // Settings paints instantly while the controller fetch refreshes it.
  const [data, setData] = useState<ConfigData | null>(() =>
    readPageCache<ConfigData>("settings:config"),
  );
  const [compatibilityReport, setCompatibilityReport] = useState<CompatibilityReport | null>(() =>
    readPageCache<CompatibilityReport>("settings:compat"),
  );
  // Config/compat (the heavy /config + /compat controller round-trips) are only
  // consumed by the System section. They load lazily the first time System is
  // opened, so the default Connection landing paints from /api/settings alone.
  // `loading` therefore starts false — nothing is in flight until then.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const configRequestedRef = useRef(false);

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
        setApiSettings(mergeApiSettings(settings));
        return;
      }
    } catch (e) {
      console.error("Failed to load API settings:", e);
    } finally {
      setApiSettingsLoading(false);
    }
    setApiSettings(mergeApiSettings(undefined));
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
      // A reachable controller means first-run setup is effectively done. This
      // flag used to be set by the config fetch, which now loads lazily.
      if (typeof window !== "undefined" && !localStorage.getItem("local-studio-setup-complete")) {
        localStorage.setItem("local-studio-setup-complete", "true");
      }
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
      writePageCache("settings:config", configData);
      if (compatibility) writePageCache("settings:compat", compatibility);
      setData(configData);
      setCompatibilityReport(compatibility);
      setBackendOnline(true);
      if (typeof window !== "undefined" && !localStorage.getItem("local-studio-setup-complete")) {
        localStorage.setItem("local-studio-setup-complete", "true");
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
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Partial<ApiConnectionSettings>;
        setApiSettings(mergeApiSettings(updated));
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

  // Lazy trigger: called when the System section becomes active. Fires the
  // config/compat fetch exactly once (subsequent visits reuse the cached data);
  // explicit refresh via `loadConfig` still forces a reload.
  const ensureConfigLoaded = useCallback(() => {
    if (configRequestedRef.current) return;
    configRequestedRef.current = true;
    void loadConfig();
  }, [loadConfig]);

  useMountSubscription(() => {
    void loadApiSettings();
    // Cheap /status probe (not /config) so the first-run setup wizard gate still
    // knows whether the controller is reachable without the heavy config fetch.
    void checkBackendHealth();
  }, [checkBackendHealth, loadApiSettings]);

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
    ensureConfigLoaded,
    saveApiSettings,
    testConnection,
    hasConfigData: Boolean(data),
    isInitialLoading: loading && !data,
    backendOnline,
  };
}
