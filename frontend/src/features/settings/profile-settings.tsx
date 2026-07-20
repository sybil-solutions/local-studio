"use client";

import { useRef, useState } from "react";
import { Check, Copy, Smartphone, Upload } from "@/ui/icon-registry";
import { Input } from "@/ui";
import {
  PROFILE_HUES,
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";
import { QrCode } from "@/features/shell/qr-code";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton, SettingsGroup } from "./settings-ui";

export function ProfileSettings() {
  const [profile, updateProfile] = useLocalProfile();
  const [imageError, setImageError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const updateImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      updateProfile({ imageUrl: await profileImageFromFile(file) });
      setImageError("");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Image failed to load");
    }
  };

  return (
    <div className="space-y-10">
      <SettingsGroup
        title="Your profile"
        description="Shown in the sidebar and alongside local usage."
      >
        <div className="grid gap-6 px-1 py-6 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center sm:px-3">
          <div className="flex flex-col items-center gap-3 sm:items-start">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="group relative rounded-full outline-none ring-offset-4 ring-offset-(--ui-bg) focus-visible:ring-2 focus-visible:ring-(--ui-fg)/50"
              aria-label="Update profile image"
            >
              <ProfileAvatar profile={profile} size={88} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Upload className="h-5 w-5 text-white" />
              </span>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void updateImage(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:text-(--ui-fg)"
            >
              Change photo
            </button>
          </div>
          <div className="min-w-0 space-y-5">
            <div>
              <label
                htmlFor="profile-display-name"
                className="mb-1.5 block text-[length:var(--fs-sm)] font-medium text-(--ui-fg)"
              >
                Display name
              </label>
              <Input
                id="profile-display-name"
                value={profile.name}
                onChange={(event) => updateProfile({ name: event.target.value })}
                onBlur={() => {
                  if (!profile.name.trim()) updateProfile({ name: "Studio" });
                }}
                className="h-9 max-w-sm"
                placeholder="Studio"
              />
            </div>
            <div>
              <div className="mb-2 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
                Avatar color
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {PROFILE_HUES.map((hue) => (
                  <button
                    key={hue}
                    type="button"
                    onClick={() => updateProfile({ hue })}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-fg)/50"
                    style={{ background: `oklch(0.55 0.13 ${hue})` }}
                    aria-label={`Avatar color ${hue}`}
                    aria-pressed={profile.hue === hue}
                  >
                    {profile.hue === hue ? <Check className="h-4 w-4 text-white" /> : null}
                  </button>
                ))}
                {profile.imageUrl ? (
                  <SettingsButton onClick={() => updateProfile({ imageUrl: undefined })}>
                    Remove photo
                  </SettingsButton>
                ) : null}
              </div>
            </div>
            {imageError ? (
              <p className="text-[length:var(--fs-sm)] text-(--err)">{imageError}</p>
            ) : null}
          </div>
        </div>
      </SettingsGroup>
      <PhonePairingSettings />
    </div>
  );
}

function PhonePairingSettings() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useMountSubscription(() => setUrl(window.location.origin), []);
  const urlTooLong = new TextEncoder().encode(url).length > 78;
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <SettingsGroup
      title="Connect your phone"
      description="Open this Studio from your phone camera without typing the address."
    >
      <div className="grid overflow-hidden sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex items-center justify-center bg-(--ui-surface)/55 px-5 py-7 sm:min-h-[284px]">
          <div className="flex h-48 w-48 items-center justify-center rounded-2xl bg-white p-2.5 shadow-[0_16px_45px_-28px_rgba(0,0,0,0.8)]">
            {url && !urlTooLong ? (
              <QrCode value={url} label={`QR code for ${url}`} />
            ) : (
              <span className="px-4 text-center text-[length:var(--fs-sm)] text-black/55">
                {urlTooLong ? "Use a shorter URL" : "Enter a Studio URL"}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center px-1 py-7 sm:px-8">
          <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-(--ui-hover) text-(--ui-fg)">
            <Smartphone className="h-4.5 w-4.5" />
          </div>
          <h4 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
            Scan to open Studio
          </h4>
          <p className="mt-1.5 max-w-md text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            {loopback
              ? "This local address only works on this Mac. Replace it with your LAN or Tailscale address before scanning."
              : urlTooLong
                ? "The QR code supports Studio URLs up to 78 bytes."
                : "The code updates as you edit the address below."}
          </p>
          <label
            htmlFor="phone-studio-url"
            className="mb-1.5 mt-5 block text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.08em] text-(--ui-muted)"
          >
            Studio address
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="phone-studio-url"
              value={url}
              maxLength={72}
              onChange={(event) => setUrl(event.target.value.trim())}
              className="h-9 min-w-0 flex-1 font-mono text-[length:var(--fs-sm)]"
              aria-label="Studio URL encoded in QR code"
            />
            <SettingsButton
              onClick={() => void copy()}
              disabled={!url}
              aria-label="Copy Studio address"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </SettingsButton>
          </div>
        </div>
      </div>
    </SettingsGroup>
  );
}
