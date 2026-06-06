"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./utils";

type ModalMaxWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "drawer";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  icon?: ReactNode;
  maxWidth?: ModalMaxWidth;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  zIndex?: number;
}

const maxWidthClasses: Record<ModalMaxWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  drawer: "max-w-2xl",
};

function Modal({
  isOpen,
  onClose,
  title,
  icon,
  maxWidth = "lg",
  footer,
  children,
  className = "",
  zIndex = 50,
}: ModalProps) {
  if (!isOpen) return null;

  const isDrawer = maxWidth === "drawer";

  if (isDrawer) {
    return (
      <div className="fixed inset-0 flex" style={{ zIndex }}>
        <button className="flex-1 bg-black/60" onClick={onClose} aria-label="Close" />
        <div
          className={`flex h-full w-full max-w-2xl flex-col border-l border-(--ui-border) bg-(--ui-surface) animate-in slide-in-from-right duration-200 ${className}`}
        >
          {title && (
            <div className="flex shrink-0 items-center justify-between border-b border-(--ui-border) bg-(--ui-surface) px-6 py-4">
              <div className="flex items-center gap-3">
                {icon}
                <h3 className="text-lg font-semibold">{title}</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 transition-colors hover:bg-(--ui-hover)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-6">{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center justify-between border-t border-(--ui-border) bg-(--ui-surface) px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex }}>
      <button
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className={`relative z-10 mx-4 w-full ${maxWidthClasses[maxWidth]} rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-xl ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-(--ui-border) px-6 py-4">
            <div className="flex items-center gap-2">
              {icon}
              <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1.5 transition-colors hover:bg-(--ui-hover)"
            >
              <X className="h-5 w-5 text-(--ui-muted)" />
            </button>
          </div>
        )}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-(--ui-border) px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface UiModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

const UiModalTitleIdContext = createContext<string | null>(null);

function UiModal({ isOpen, onClose, children, className, maxWidth = "max-w-lg" }: UiModalProps) {
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative z-10 w-full rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-xl",
          maxWidth,
          className,
        )}
      >
        <UiModalTitleIdContext.Provider value={titleId}>{children}</UiModalTitleIdContext.Provider>
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

function UiModalHeader({
  title,
  icon,
  onClose,
  actions,
  closeLabel = "Close",
  className,
  showCloseButton = true,
  closeIcon,
}: UiModalHeaderProps) {
  const titleId = useContext(UiModalTitleIdContext);

  return (
    <div
      className={cx(
        "flex items-center justify-between border-b border-(--ui-border) px-6 py-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 id={titleId ?? undefined} className="text-lg font-semibold">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && onClose ? (
          <button
            onClick={onClose}
            className="rounded p-1.5 hover:bg-(--ui-hover)"
            aria-label={closeLabel}
          >
            {closeIcon ?? "x"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { Modal, UiModal, UiModalHeader };
export type { ModalProps, ModalMaxWidth, UiModalProps, UiModalHeaderProps };
