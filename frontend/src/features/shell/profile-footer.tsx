"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Settings, Smartphone, Upload } from "@/ui/icon-registry";
import { Input, UiModal, UiModalHeader } from "@/ui";
import {
  PROFILE_HUES,
  ProfileAvatar,
  profileImageFromFile,
  useLocalProfile,
} from "@/features/shell/local-profile";
import { QrCode } from "@/features/shell/qr-code";

function PhoneConnectModal({ onClose }: { onClose: () => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [url, setUrl] = useState(origin);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const loopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(url);
  const urlTooLong = new TextEncoder().encode(url).length > 78;
  return (
    <UiModal isOpen onClose={onClose} maxWidth="max-w-sm">
      <UiModalHeader title="Use Studio on your phone" onClose={onClose} />
      <div className="space-y-4 p-5 text-[length:var(--fs-base)] text-(--fg)/85">
        <div className="mx-auto flex h-52 w-52 items-center justify-center overflow-hidden rounded-2xl bg-white p-2">
          {url && !urlTooLong ? (
            <QrCode value={url} label={`QR code for ${url}`} />
          ) : (
            <span className="px-5 text-center text-[length:var(--fs-sm)] text-black/55">
              {urlTooLong ? "Use a shorter URL" : "Enter a Studio URL"}
            </span>
          )}
        </div>
        <div>
          <label
            htmlFor="phone-studio-url"
            className="mb-1.5 block text-[length:var(--fs-sm)] text-(--fg)/55"
          >
            Studio URL
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="phone-studio-url"
              value={url}
              maxLength={72}
              onChange={(event) => setUrl(event.target.value.trim())}
              className="h-9 min-w-0 flex-1 font-mono text-[length:var(--fs-sm)]"
              aria-label="Studio URL encoded in QR code"
            />
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!url}
              className="h-9 shrink-0 rounded-lg border border-(--border) px-3 text-[length:var(--fs-sm)] transition-colors hover:bg-(--hover) disabled:opacity-40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <p className="text-[length:var(--fs-sm)] leading-relaxed text-(--fg)/50">
          {loopback
            ? "This address only works on this Mac. Replace it with this Studio’s LAN or Tailscale URL before scanning."
            : urlTooLong
              ? "The QR code supports Studio URLs up to 78 bytes."
              : "Scan with your phone camera to open this Studio directly."}
        </p>
      </div>
    </UiModal>
  );
}

export function ProfileFooter({ settingsActive }: { settingsActive: boolean }) {
  const [profile, updateProfile] = useLocalProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
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
    <div className="relative">
      {phoneOpen ? <PhoneConnectModal onClose={() => setPhoneOpen(false)} /> : null}
      {menuOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-2xl border border-(--color-popover-border) bg-(--color-popover) p-3 shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.35)]">
          <div className="mb-3 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="group relative rounded-full"
              title="Update profile image"
              aria-label="Update profile image"
            >
              <ProfileAvatar profile={profile} size={32} />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Upload className="h-3.5 w-3.5 text-white" />
              </span>
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void updateImage(event.currentTarget.files?.[0])}
            />
            <Input
              value={profile.name}
              onChange={(event) => updateProfile({ name: event.target.value })}
              placeholder="Display name"
              className="h-8"
            />
          </div>
          {imageError ? (
            <p className="mb-2 text-[length:var(--fs-xs)] text-(--err)">{imageError}</p>
          ) : null}
          <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
            {PROFILE_HUES.map((hue) => (
              <button
                key={hue}
                type="button"
                onClick={() => updateProfile({ hue })}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  profile.hue === hue
                    ? "ring-2 ring-(--fg)/60 ring-offset-2 ring-offset-(--color-popover)"
                    : ""
                }`}
                style={{ background: `oklch(0.55 0.13 ${hue})` }}
                aria-label={`Avatar color ${hue}`}
              />
            ))}
            {profile.imageUrl ? (
              <button
                type="button"
                onClick={() => updateProfile({ imageUrl: undefined })}
                className="ml-auto text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
              >
                Remove photo
              </button>
            ) : null}
          </div>
          <Link
            href="/settings"
            prefetch={false}
            onClick={() => setMenuOpen(false)}
            className="flex h-8 items-center gap-2 rounded-lg px-2 text-[length:var(--fs-md)] text-(--fg)/85 transition-colors hover:bg-(--hover)"
          >
            <Settings className="h-3.5 w-3.5 opacity-70" strokeWidth={1.75} />
            Settings
          </Link>
        </div>
      ) : null}
      <div className="flex h-[var(--sidebar-row-height)] items-center gap-1">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.parentElement?.contains(next)) return;
            setMenuOpen(false);
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 py-1 text-left transition-colors hover:bg-(--hover)"
          aria-expanded={menuOpen}
          aria-label="Profile menu"
        >
          <ProfileAvatar profile={profile} />
          <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{profile.name}</span>
        </button>
        <button
          type="button"
          onClick={() => setPhoneOpen(true)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] text-(--fg)/60 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          title="Use Studio on your phone"
          aria-label="Use Studio on your phone"
        >
          <Smartphone className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <Link
          href="/settings"
          prefetch={false}
          title="Settings"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] transition-colors ${
            settingsActive
              ? "bg-(--active) text-(--fg)"
              : "text-(--fg)/60 hover:bg-(--hover) hover:text-(--fg)"
          }`}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  );
}
