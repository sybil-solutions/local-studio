// CRITICAL
"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import type { ConfigData } from "@/lib/types";

export interface ApiConnectionSettings {
  backendUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  voiceUrl: string;
  voiceModel: string;
}

export type ConnectionStatus = "unknown" | "connected" | "error";

export function useConfigs() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [apiSettings, setApiSettings] = useState<ApiConnectionSettings>({
    backendUrl: "http://localhost:8080",
    apiKey: "",
    hasApiKey: false,
    voiceUrl: "",
    voiceModel: "whisper-large-v3-turbo",
  });
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
        const settings = await res.json();
        setApiSettings({
          backendUrl: settings.backendUrl || "http://localhost:8080",
          apiKey: settings.apiKey || "",
          hasApiKey: settings.hasApiKey || false,
          voiceUrl: settings.voiceUrl || "",
          voiceModel: settings.voiceModel || "whisper-large-v3-turbo",
        });
      }
    } catch (e) {
      console.error("Failed to load API settings:", e);
    } finally {
      setApiSettingsLoading(false);
    }
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const configData = await api.getSystemConfig();
      setData(configData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveApiSettings = async () => {
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
        const updated = await res.json();
        setApiSettings({
          backendUrl: updated.backendUrl,
          apiKey: updated.apiKey,
          hasApiKey: updated.hasApiKey,
          voiceUrl: updated.voiceUrl || apiSettings.voiceUrl,
          voiceModel: updated.voiceModel || apiSettings.voiceModel,
        });
        setStatusMessage("Settings saved");
        loadConfig();
      } else {
        const err = await res.json();
        setStatusMessage(err.error || "Failed to save");
        setConnectionStatus("error");
      }
    } catch {
      setStatusMessage("Failed to save settings");
      setConnectionStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setConnectionStatus("unknown");
      setStatusMessage("Testing...");

      const baseUrl =
        process.env.BACKEND_URL ||
        process.env.NEXT_PUBLIC_BACKEND_URL ||
        process.env.VLLM_STUDIO_BACKEND_URL ||
        "https://<your-api-domain>";
      const res = await fetch(`${baseUrl}/health`);
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
  };
}
