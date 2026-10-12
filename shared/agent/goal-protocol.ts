//
// The wire protocol between the goal continuation driver (server) and the
// transcript (client). Two strings cross the process boundary and have to be
// recognised identically on both sides, so they live here rather than being
// spelled out twice:
//
//  1. THE CONTINUATION PROMPT. The driver keeps a goal moving by re-prompting
//     the agent through the ordinary user channel, which means the runtime
//     echoes it back as a `role: "user"` message and the timeline used to
//     render it as words the user never typed. Wrapping it in a tag gives the
//     client one unambiguous test — the same classification ZCode applies to
//     its `<system-reminder source="goal-continuation">` turns, which the model
//     sees and the transcript does not.
//
//  2. THE OUTCOME SENTINELS. The model ends a turn with GOAL_COMPLETE or
//     GOAL_BLOCKED <reason>; the driver reads them to settle the goal. They are
//     protocol, not prose, so the timeline strips them out of the rendered
//     bubble and shows the outcome as a marker row instead.
//

export const GOAL_CONTINUATION_TAG = "goal_continuation";

export const GOAL_COMPLETE_SENTINEL = "GOAL_COMPLETE";
export const GOAL_BLOCKED_SENTINEL = "GOAL_BLOCKED";

export function goalContinuationPrompt(objective: string): string {
  return [
    `<${GOAL_CONTINUATION_TAG}>`,
    `Continue working toward the goal: ${objective}`,
    "Check progress against concrete evidence (files, command output, runtime behaviour) before deciding what to do next.",
    `If the goal is fully achieved, end your reply with ${GOAL_COMPLETE_SENTINEL}.`,
    `If you cannot make further progress, end your reply with ${GOAL_BLOCKED_SENTINEL} and the reason.`,
    `</${GOAL_CONTINUATION_TAG}>`,
  ].join("\n");
}

/** True for the driver's own re-prompt. The client drops these so a long goal
 *  reads as the agent continuing to work rather than talking to itself. */
export function isGoalContinuationPrompt(text: string): boolean {
  return text.trimStart().startsWith(`<${GOAL_CONTINUATION_TAG}>`);
}

export type GoalOutcome = { kind: "complete" } | { kind: "blocked"; reason: string };

const COMPLETE_SENTINEL_LINE_RE = /(?:^|\n)[ \t]*GOAL_COMPLETE[ \t]*$/;
const BLOCKED_SENTINEL_LINE_RE =
  /(?:^|\n)[ \t]*GOAL_BLOCKED(?![A-Za-z0-9_])(?:[ \t]*[:\-–—]?[ \t]*([^\n]*))?[ \t]*$/;
const SENTINEL_LINE_RE =
  /(?:^|\n)[ \t]*(?:GOAL_COMPLETE|GOAL_BLOCKED(?![A-Za-z0-9_])(?:[ \t]*[:\-–—]?[ \t]*[^\n]*)?)[ \t]*$/;

/** The outcome a settled turn declared, or null when it declared none. */
export function goalOutcomeFromText(text: string): GoalOutcome | null {
  const finalText = text.trimEnd();
  if (COMPLETE_SENTINEL_LINE_RE.test(finalText)) return { kind: "complete" };
  const blocked = BLOCKED_SENTINEL_LINE_RE.exec(finalText);
  return blocked ? { kind: "blocked", reason: (blocked[1] ?? "").trim() } : null;
}

// Mid-stream the sentinel arrives a few tokens at a time, so the tail can hold
// a strict prefix of one ("GOAL_COMP") that the full pattern cannot see yet.
// Hiding those keeps the protocol from flickering through the bubble one token
// at a time. Six characters is the shortest prefix that commits to a sentinel
// ("GOAL_C" / "GOAL_B"), which leaves the ordinary words "goal" and "GOAL_"
// alone.
const PARTIAL_TAIL_RE = /(?:^|\n)[ \t]*(GOAL_[A-Z]*)$/;

function stripPartialSentinelTail(text: string): string {
  const match = PARTIAL_TAIL_RE.exec(text);
  const candidate = match?.[1];
  if (!candidate || candidate.length < 6) return text;
  if (
    !GOAL_COMPLETE_SENTINEL.startsWith(candidate) &&
    !GOAL_BLOCKED_SENTINEL.startsWith(candidate)
  ) {
    return text;
  }
  return text.slice(0, text.length - candidate.length);
}

/** Remove the outcome protocol from text that is about to be rendered.
 *  Returns the input unchanged (same value) when there was nothing to strip, so
 *  callers can use the result to decide whether anything moved. */
export function stripGoalSentinels(text: string): string {
  const stripped = stripPartialSentinelTail(text.replace(SENTINEL_LINE_RE, ""));
  return stripped === text ? text : stripped.trimEnd();
}
