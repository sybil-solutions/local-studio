"use client";

import { memo } from "react";
import { PhoneOff, Volume2 } from "lucide-react";

interface CallModeIndicatorProps {
  isSpeaking: boolean;
  onDisable: () => void;
}

export const CallModeIndicator = memo(function CallModeIndicator({
  isSpeaking,
  onDisable,
}: CallModeIndicatorProps) {
  return (
    <div className="flex items-center gap-2.5 mb-3 mx-3 md:mx-0 px-3 py-2 border border-(--hl2)/20 rounded-lg transition-all:ease-in:200ms">
      <div className="w-2.5 h-2.5 rounded-full bg-(--hl2) animate-pulse" />
      <span className="font-sans font-medium text-sm text-(--hl2)">Call mode</span>
      {isSpeaking && (
        <span className="flex items-center gap-1 text-xs text-(--dim)">
          <Volume2 className="h-3 w-3" />
          Speaking…
        </span>
      )}
      <button
        onClick={onDisable}
        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 font-sans font-medium text-sm rounded-lg bg-(--err) text-white hover:opacity-90"
      >
        <PhoneOff className="h-3 w-3" />
        End
      </button>
    </div>
  );
});
