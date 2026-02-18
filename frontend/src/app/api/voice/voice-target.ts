import type { ApiSettings } from "@/lib/api-settings";

export type VoiceTargetKind = "controller-local" | "external-voice";

export interface VoiceTarget {
  baseUrl: string;
  kind: VoiceTargetKind;
}

const normalizeHttpUrl = (value: string | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export const resolveVoiceTarget = (settings: ApiSettings): VoiceTarget | null => {
  const backendUrl = normalizeHttpUrl(settings.backendUrl);
  const configuredVoiceUrl = normalizeHttpUrl(settings.voiceUrl);

  if (configuredVoiceUrl) {
    if (backendUrl && configuredVoiceUrl === backendUrl) {
      return { baseUrl: configuredVoiceUrl, kind: "controller-local" };
    }
    return { baseUrl: configuredVoiceUrl, kind: "external-voice" };
  }

  if (!backendUrl) {
    return null;
  }

  return { baseUrl: backendUrl, kind: "controller-local" };
};
