"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { UiModal, UiModalBody, UiModalFooter, UiModalHeader } from "./modal";

export type ConfirmDeleteModalProps = {
  title: string;
  message: ReactNode;
  /** The destructive verb, so the button says what it does rather than "OK". */
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * One destructive confirmation for the whole app.
 *
 * Every surface — Models, Settings, the sidebar — asks through this dialog so
 * a delete is never an inline popover clipped inside the thing that triggered
 * it. The confirm handler may be async; the button holds its loading state
 * until the promise settles so a slow delete cannot be fired twice.
 */
export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel = "Delete",
  onCancel,
  onConfirm,
}: ConfirmDeleteModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onCancel();
  };

  return (
    <UiModal isOpen onClose={close} maxWidth="max-w-md">
      <UiModalHeader title={title} onClose={busy ? undefined : onCancel} />
      <UiModalBody>
        <div className="space-y-2 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
          {typeof message === "string" ? <p>{message}</p> : message}
          {error ? <p className="text-(--err)">{error}</p> : null}
        </div>
      </UiModalBody>
      <UiModalFooter>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="danger"
          loading={busy}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void Promise.resolve(onConfirm())
              .then(onCancel)
              .catch((caught: unknown) => {
                setBusy(false);
                setError(caught instanceof Error ? caught.message : "Something went wrong");
              });
          }}
        >
          {confirmLabel}
        </Button>
      </UiModalFooter>
    </UiModal>
  );
}
