"use client";

import { createContext, useContext, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/ui/icon-registry";
import { useDialogFocusTrap } from "./dialog-focus";
import { MODAL_SURFACE_CLASS } from "./popover";
import { cx } from "./utils";

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
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap({ dialogRef, active: isOpen, onClose });

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 z-0 bg-(--color-scrim) backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          `relative z-10 flex max-h-full w-full flex-col outline-none ${MODAL_SURFACE_CLASS}`,
          maxWidth,
          className,
        )}
      >
        <UiModalTitleIdContext.Provider value={titleId}>{children}</UiModalTitleIdContext.Provider>
      </div>
    </div>,
    document.body,
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
      className={cx("flex shrink-0 items-start justify-between gap-3 px-6 pb-3 pt-5", className)}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h2
          id={titleId ?? undefined}
          className="text-[length:var(--fs-lg)] font-semibold tracking-[-0.01em] text-(--ui-fg)"
        >
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) active:scale-[0.98]"
            aria-label={closeLabel}
          >
            {closeIcon ?? <X className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Scrolling content region. Owns the dialog's horizontal rhythm so call sites
 * stop inventing their own `p-4` / `p-6` / `px-5 pb-4 pt-2`.
 */
function UiModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("min-h-0 flex-1 overflow-y-auto px-6 pb-1", className)}>{children}</div>
  );
}

interface UiModalFooterProps {
  children: ReactNode;
  /** Rendered hard left, opposite the confirm/cancel pair — destructive actions live here. */
  leading?: ReactNode;
  className?: string;
}

/**
 * Action row. No divider and no tinted bar: the buttons sit on the dialog
 * surface itself, so the footer reads as part of the sheet.
 */
function UiModalFooter({ children, leading, className }: UiModalFooterProps) {
  return (
    <div
      className={cx("flex shrink-0 items-center justify-between gap-3 px-6 pb-5 pt-4", className)}
    >
      <div className="flex items-center gap-2">{leading}</div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export { UiModal, UiModalHeader, UiModalBody, UiModalFooter };
export type { UiModalProps, UiModalHeaderProps, UiModalFooterProps };
