"use client";

import { Button, UiModal, UiModalHeader } from "@/ui";

type Props = {
  recipeName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteRecipeConfirmModal({ recipeName, onCancel, onConfirm }: Props) {
  return (
    <UiModal isOpen onClose={onCancel} maxWidth="max-w-md">
      <UiModalHeader title="Delete Recipe" onClose={onCancel} />
      <div className="p-6">
        <p className="mb-6 text-sm text-(--ui-muted)">
          Are you sure you want to delete &quot;
          {recipeName}&quot;?
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </UiModal>
  );
}
