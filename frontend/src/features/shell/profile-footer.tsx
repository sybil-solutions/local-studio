"use client";

// Codex-style sidebar footer: a local profile (avatar + display name, stored
// on this machine) with a small menu, plus the phone entry point and the
// Settings gear. No accounts — the profile is presentation for this Studio.

import Link from "next/link";
import { useState } from "react";
import { Settings, Smartphone } from "@/ui/icon-registry";
import { Input, UiModal, UiModalHeader } from "@/ui";

const PROFILE_KEY = "local-studio.profile";

type Profile = { name: string; hue: number };

const DEFAULT_PROFILE: Profile = { name: "Studio", hue: 214 };
const HUES = [214, 262, 152, 24, 340, 46];

function readProfile(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      name:
        typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : DEFAULT_PROFILE.name,
      hue: typeof parsed.hue === "number" ? parsed.hue : DEFAULT_PROFILE.hue,
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function writeProfile(profile: Profile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // best-effort
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "S";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}

function Avatar({ profile, size = 22 }: { profile: Profile; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `oklch(0.55 0.13 ${profile.hue})`,
      }}
      aria-hidden
    >
      {initials(profile.name)}
    </span>
  );
}

function PhoneConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <UiModal isOpen={open} onClose={onClose}>
      <UiModalHeader title="Use Studio on your phone" onClose={onClose} />
      <div className="space-y-3 p-4 text-[length:var(--fs-base)] text-(--fg)/85">
        <p className="text-(--fg)/70">
          If this Studio is reachable from your phone — a deployed instance or a tailnet address —
          open the same URL there. The interface adapts to the smaller screen.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-(--fg)/[0.05] px-3 py-2 font-mono text-[length:var(--fs-md)]">
            {origin}
          </code>
          <button
            type="button"
            onClick={() => void copy()}
            className="shrink-0 rounded-lg border border-(--border) px-3 py-2 text-[length:var(--fs-md)] transition-colors hover:bg-(--hover)"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-[length:var(--fs-sm)] text-(--fg)/45">
          Direct phone-to-desktop pairing with a QR code is on the roadmap — it will relay through
          your controller so this machine is never exposed.
        </p>
      </div>
    </UiModal>
  );
}

export function ProfileFooter({ settingsActive }: { settingsActive: boolean }) {
  const [profile, setProfile] = useState<Profile>(readProfile);
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  const update = (patch: Partial<Profile>) => {
    setProfile((current) => {
      const next = { ...current, ...patch };
      writeProfile(next);
      return next;
    });
  };

  return (
    <div className="relative">
      <PhoneConnectModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      {menuOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-60 rounded-2xl bg-(--color-popover) p-3 shadow-[0px_16px_32px_-8px_rgba(0,0,0,0.35)]">
          <div className="mb-2 flex items-center gap-2.5">
            <Avatar profile={profile} size={28} />
            <Input
              value={profile.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="Display name"
              className="h-7"
            />
          </div>
          <div className="mb-2 flex items-center gap-1.5 px-0.5">
            {HUES.map((hue) => (
              <button
                key={hue}
                type="button"
                onClick={() => update({ hue })}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  profile.hue === hue
                    ? "ring-2 ring-(--fg)/60 ring-offset-2 ring-offset-(--color-popover)"
                    : ""
                }`}
                style={{ background: `oklch(0.55 0.13 ${hue})` }}
                aria-label={`Avatar color ${hue}`}
              />
            ))}
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
          <Avatar profile={profile} />
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
