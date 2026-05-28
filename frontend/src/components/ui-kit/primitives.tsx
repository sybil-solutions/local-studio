"use client";

import type { ReactNode } from "react";

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface UiModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

export function UiModal({
  isOpen,
  onClose,
  children,
  className,
  maxWidth = "max-w-lg",
}: UiModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className={joinClassNames(
          "relative z-10 w-full border border-(--border) bg-(--surface) rounded-xl shadow-xl",
          maxWidth,
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface UiModalHeaderProps {
  title: string;
  icon?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
  closeLabel?: string;
  className?: string;
  showCloseButton?: boolean;
  closeIcon?: ReactNode;
}

export function UiModalHeader({
  title,
  icon,
  onClose,
  actions,
  closeLabel = "Close",
  className,
  showCloseButton = true,
  closeIcon,
}: UiModalHeaderProps) {
  return (
    <div
      className={joinClassNames(
        "flex items-center justify-between px-6 py-4 border-b border-(--border)",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-(--accent)"
            aria-label={closeLabel}
          >
            {closeIcon ?? "×"}
          </button>
        )}
      </div>
    </div>
  );
}
