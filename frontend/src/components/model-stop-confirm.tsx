"use client";

import { useState, type ReactNode } from "react";
import { LoaderCircle, Square, TriangleAlert, X } from "lucide-react";
import { Button, UiModal, UiModalHeader } from "@/components/ui-kit";

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
          title="Stop model?"
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--err)/30 bg-(--err)/10">
              <Square className="h-3.5 w-3.5 text-(--err)" fill="currentColor" />
            </span>
          }
          onClose={() => !stopping && setOpen(false)}
          closeIcon={<X className="h-4 w-4" />}
          className="border-(--err)/20 bg-(--err)/[0.03]"
        />
        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border border-(--border)/70 bg-(--bg)/60 p-4">
            <div className="flex gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-(--err)" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-(--fg)">Active inference will end now.</p>
                <p className="text-sm leading-6 text-(--dim)">
                  Running chats may stop responding while the GPU lease is released.
                </p>
              </div>
            </div>
          </div>
          {error && (
            <div className="rounded-lg border border-(--err)/40 bg-(--err)/10 px-3 py-2 text-sm text-(--err)">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={stopping}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmStop} disabled={stopping}>
              {stopping && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {stopping ? "Stopping..." : "Stop model"}
            </Button>
          </div>
        </div>
      </UiModal>
    </>
  );
}
