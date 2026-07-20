"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const PROFILE_KEY = "local-studio.profile";
const PROFILE_EVENT = "local-studio:profile-change";
const MAX_PROFILE_IMAGE_BYTES = 2_000_000;

const LocalProfileSchema = Schema.Struct({
  name: Schema.String,
  hue: Schema.Number,
  imageUrl: Schema.optionalKey(Schema.String),
});

const decodeLocalProfile = Schema.decodeUnknownOption(LocalProfileSchema);

export type LocalProfile = typeof LocalProfileSchema.Type;

export const DEFAULT_PROFILE: LocalProfile = { name: "Studio", hue: 214 };
export const PROFILE_HUES = [214, 262, 152, 24, 340, 46] as const;

export function readLocalProfile(): LocalProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const option = decodeLocalProfile(
      JSON.parse(window.localStorage.getItem(PROFILE_KEY) ?? "null"),
    );
    if (option._tag !== "Some") return DEFAULT_PROFILE;
    return {
      name: option.value.name,
      hue: option.value.hue,
      ...(option.value.imageUrl ? { imageUrl: option.value.imageUrl } : {}),
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function writeLocalProfile(profile: LocalProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    window.dispatchEvent(new Event(PROFILE_EVENT));
  } catch {}
}

export function useLocalProfile(): [LocalProfile, (patch: Partial<LocalProfile>) => void] {
  const [profile, setProfile] = useState<LocalProfile>(DEFAULT_PROFILE);
  useMountSubscription(() => {
    const sync = () => setProfile(readLocalProfile());
    sync();
    window.addEventListener(PROFILE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PROFILE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = useCallback((patch: Partial<LocalProfile>) => {
    const next = { ...readLocalProfile(), ...patch };
    setProfile(next);
    writeLocalProfile(next);
  }, []);
  return [profile, update];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "S";
  const second = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

export function ProfileAvatar({ profile, size = 22 }: { profile: LocalProfile; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-cover bg-center font-medium text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        backgroundColor: `oklch(0.55 0.13 ${profile.hue})`,
        ...(profile.imageUrl
          ? { backgroundImage: `url(${JSON.stringify(profile.imageUrl).slice(1, -1)})` }
          : {}),
      }}
      aria-hidden
    >
      {profile.imageUrl ? null : initials(profile.name)}
    </span>
  );
}

export async function profileImageFromFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  if (file.size > MAX_PROFILE_IMAGE_BYTES) throw new Error("Choose an image smaller than 2 MB");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image failed to load"));
    reader.onerror = () => reject(new Error("Image failed to load"));
    reader.readAsDataURL(file);
  });
}
