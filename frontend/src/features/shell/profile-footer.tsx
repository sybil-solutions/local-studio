"use client";

import Link from "next/link";
import { Download, RefreshCw, Settings, Smartphone } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { ProfileAvatar, useLocalProfile } from "@/features/shell/local-profile";
import { useAppUpdate } from "@/features/shell/use-app-update";

function UpdateButton() {
  const update = useAppUpdate();
  if (!update.updateAvailable) return null;
  const progress = update.progress === null ? null : Math.round(update.progress);
  const label =
    update.phase === "ready"
      ? `Restart to update to v${update.latestVersion}`
      : update.status === "downloading"
        ? `Downloading v${update.latestVersion}${progress === null ? "" : ` — ${progress}%`}`
        : update.status === "checking"
          ? `Checking for v${update.latestVersion}…`
          : `Update to v${update.latestVersion}`;
  return (
    <button
      type="button"
      onClick={update.startUpdate}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] text-(--color-primary) transition-colors hover:bg-(--hover) hover:text-(--fg)"
    >
      {update.status === "checking" ? (
        <Spinner size="xs" />
      ) : update.status === "downloading" && progress !== null ? (
        <span className="text-[8px] font-medium tabular-nums">{progress}%</span>
      ) : update.phase === "ready" ? (
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.6} />
      ) : (
        <Download className="h-3.5 w-3.5" strokeWidth={1.6} />
      )}
    </button>
  );
}

export function ProfileFooter({ settingsActive }: { settingsActive: boolean }) {
  const [profile] = useLocalProfile();

  return (
    <div className="flex h-[var(--sidebar-row-height)] items-center gap-1">
      <Link
        href="/settings#profile"
        prefetch={false}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--sidebar-row-radius)] px-2 py-1 text-left transition-colors hover:bg-(--hover)"
        aria-label="Profile settings"
      >
        <ProfileAvatar profile={profile} />
        <span className="truncate text-[length:var(--fs-md)] text-(--fg)">{profile.name}</span>
      </Link>
      <UpdateButton />
      <Link
        href="/settings#profile"
        prefetch={false}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--sidebar-row-radius)] text-(--fg)/60 transition-colors hover:bg-(--hover) hover:text-(--fg)"
        title="Connect phone"
        aria-label="Connect phone in settings"
      >
        <Smartphone className="h-3.5 w-3.5" strokeWidth={1.6} />
      </Link>
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
        <Settings className="h-3.5 w-3.5" strokeWidth={1.6} />
      </Link>
    </div>
  );
}
