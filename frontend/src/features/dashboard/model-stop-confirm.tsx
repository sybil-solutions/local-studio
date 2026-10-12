"use client";

import { useState, type ReactNode } from "react";
import { Square, TriangleAlert } from "@/ui/icon-registry";
import { Button, ErrorBox, UiModal, UiModalBody, UiModalFooter, UiModalHeader, Spinner } from "@/ui";

type StopTriggerArgs = {
  open: () => void;
  stopping: boolean;
};

type ModelStopConfirmProps = {
  trigger: (args: StopTriggerArgs) => ReactNode;
  onStop: () => Promise<void> | void;
};

export function ModelStopConfirm({ trigger, onStop }: ModelStopConfirmProps) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmStop = async () => {
    setStopping(true);
    setError(null);
    try {
      await onStop();
      setOpen(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setStopping(false);
    }
  };

  return (
    <>
      {trigger({
        open: () => {
          setError(null);
          setOpen(true);
        },
        stopping,
      })}
      <UiModal isOpen={open} onClose={() => !stopping && setOpen(false)} maxWidth="max-w-md">
        <UiModalHeader
          title="Stop model"
          icon={<Square className="h-3 w-3 text-(--err)" fill="currentColor" />}
          onClose={() => !stopping && setOpen(false)}
        />
        <UiModalBody>
          <div className="flex gap-2.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--err)" />
            <div className="space-y-1">
              <p className="text-[length:var(--fs-base)] font-medium text-(--fg)">
                Active inference will end now.
              </p>
              <p className="text-[length:var(--fs-base)] leading-relaxed text-(--dim)">
                Running chats may stop responding while the GPU lease is released.
              </p>
            </div>
          </div>
          {error ? <ErrorBox className="mt-3">{error}</ErrorBox> : null}
        </UiModalBody>
        <UiModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={stopping}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmStop} disabled={stopping}>
            {stopping && <Spinner size="sm" />}
            {stopping ? "Stopping..." : "Stop model"}
          </Button>
        </UiModalFooter>
      </UiModal>
    </>
  );
}
