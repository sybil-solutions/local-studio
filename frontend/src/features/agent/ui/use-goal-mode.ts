"use client";

import { useCallback, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";

/** ChatGPT-style goal mode for the composer.
 *
 * Selecting /goal with nothing typed flips the composer into a mode: a Target
 * pill, a goal placeholder, and the next submit sets the objective AND
 * dispatches it as the opening turn so the agent starts pursuing immediately —
 * setting a goal on an idle session used to do nothing until the next message,
 * because the continuation driver only fires on turn-settle. */
export function useGoalMode({
  goalAction,
  reportError,
  sendMessage,
  goalMode,
  setGoalMode,
}: {
  goalAction: (args: string) => Promise<string | null>;
  /** Surfaces a failed goal write the way the inline `/goal` path does. */
  reportError: (message: string) => void;
  sendMessage: (event: FormEvent) => Promise<void> | void;
  // State lives in the caller: the command registry needs the setter before
  // the send flow (which this hook depends on) exists.
  goalMode: boolean;
  setGoalMode: Dispatch<SetStateAction<boolean>>;
}): {
  goalMode: boolean;
  exitGoalMode: () => void;
  goalPlaceholder: string | null;
  /** Returns true when it consumed the submit (goal mode was active). */
  submitAsGoal: (event: FormEvent, input: string) => boolean;
  /** Escape leaves goal mode before anything else sees the key. */
  interceptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const exitGoalMode = useCallback(() => setGoalMode(false), [setGoalMode]);

  const submitAsGoal = useCallback(
    (event: FormEvent, input: string) => {
      if (!goalMode) return false;
      event.preventDefault();
      const objective = input.trim();
      if (!objective) return true;
      void goalAction(objective).then((error) => {
        // Without this the composer just swallowed the submit and looked dead.
        if (error) {
          reportError(error);
          return;
        }
        setGoalMode(false);
        // The objective is still the composer text, so the normal send path
        // turns it into the visible opening turn — already goal-steered, since
        // the goal file was written before the prompt left. On a brand-new
        // session the write is deferred until this turn hands back a
        // piSessionId, which still beats the first agent_settled the
        // continuation driver runs on.
        void sendMessage(event);
      });
      return true;
    },
    [goalAction, goalMode, reportError, sendMessage, setGoalMode],
  );

  const interceptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!goalMode || event.key !== "Escape") return false;
      event.preventDefault();
      setGoalMode(false);
      return true;
    },
    [goalMode, setGoalMode],
  );

  return {
    goalMode,
    exitGoalMode,
    goalPlaceholder: goalMode
      ? "Describe your goal — define measurable outcomes for best results"
      : null,
    submitAsGoal,
    interceptKeyDown,
  };
}
