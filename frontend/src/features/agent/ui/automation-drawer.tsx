"use client";

import { Effect } from "effect";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer, DrawerOverlay } from "@/ui/drawer";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  createAutomation,
  listAutomationModels,
  type AutomationModel,
} from "@/features/agent/automations/automation-api";
import { AutomationEditor } from "@/features/agent/automations/automation-editor";
import { NEW_AUTOMATION_DRAFT, type AutomationDraft } from "@/features/agent/automations/automation-model";

/** Turn a chat session into a scheduled automation without leaving the chat.
 *
 * The model can already call `schedule_automation`, but nothing in the UI said
 * so — this is the affordance behind `/automation`. It reuses the automations
 * page's editor in creating mode so both surfaces stay one form, and seeds the
 * draft from the pane (model, project, last thing the user asked for). */
export function AutomationDrawer({
  modelId,
  cwd,
  prompt,
  onClose,
}: {
  modelId: string;
  cwd: string;
  prompt: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [models, setModels] = useState<AutomationModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useMountSubscription(() => {
    void Effect.runPromise(listAutomationModels())
      .then(setModels)
      .catch((modelError: unknown) => {
        setError(modelError instanceof Error ? modelError.message : "Could not load models");
      });
  }, []);

  const save = useCallback(
    async (draft: AutomationDraft) => {
      setSaving(true);
      setError("");
      try {
        const automation = await Effect.runPromise(createAutomation(draft));
        onClose();
        router.push(`/agent/automations?automation=${encodeURIComponent(automation.id)}`);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "Could not create automation");
      } finally {
        setSaving(false);
      }
    },
    [onClose, router],
  );

  return (
    <DrawerOverlay onClose={onClose}>
      <Drawer width={620} className="h-full bg-(--bg)">
        <AutomationEditor
          automation={null}
          creating
          initialDraft={{ ...NEW_AUTOMATION_DRAFT, modelId, cwd, prompt }}
          models={models}
          action={saving ? "save" : null}
          error={error}
          onClose={onClose}
          onSave={(draft) => void save(draft)}
        />
      </Drawer>
    </DrawerOverlay>
  );
}
