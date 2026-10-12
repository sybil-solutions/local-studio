"use client";

import { useRouter } from "next/navigation";
import { TerminalSquare, X as XIcon } from "@/ui/icon-registry";
import {
  OPEN_TERMINAL_EVENT,
  terminalOwnerLabel,
  type OpenTerminalEventDetail,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";
import { removePersistentTerminalOwner } from "@/features/agent/ui/use-persistent-terminal-owners";

export function TerminalRow({ owner, index }: { owner: TerminalOwner; index: number }) {
  const router = useRouter();
  const label = terminalOwnerLabel(owner, index);
  const open = () => {
    router.push("/agent");
    window.dispatchEvent(
      new CustomEvent<OpenTerminalEventDetail>(OPEN_TERMINAL_EVENT, {
        detail: { mountKey: owner.mountKey },
      }),
    );
  };

  return (
    <div className="group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-2 pr-1.5 text-(--fg) transition-colors hover:bg-(--hover)">
      <button
        type="button"
        onClick={open}
        title={owner.cwd ?? owner.title}
        className="flex min-w-0 flex-1 items-center gap-2 pr-6 text-left"
      >
        <TerminalSquare
          className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-hover:opacity-90"
          strokeWidth={1.75}
        />
        <span className="truncate text-[length:var(--fs-md)] font-normal">{label}</span>
      </button>
      <button
        type="button"
        onClick={() => removePersistentTerminalOwner(owner.mountKey)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-(--dim)/55 opacity-0 transition-opacity hover:text-(--err) group-hover:opacity-100"
        title="Close terminal"
        aria-label={`Close terminal ${label}`}
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
