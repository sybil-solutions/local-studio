import { finalizeRunningToolBlocks } from "@/features/agent/messages/block-event";
import type { Session } from "./types";

const WORKING_SESSION_STATUSES: readonly string[] = ["starting", "running", "stopping", "loading"];

export function isWorkingStatus(status: string): boolean {
  return WORKING_SESSION_STATUSES.includes(status);
}

export function settleTurn(session: Session): Session {
  return { ...session, status: "idle", activeAssistantId: undefined };
}

export function settleTurnFinalizingTools(session: Session): Session {
  return {
    ...settleTurn(session),
    messages: session.messages.map((message) =>
      message.role === "assistant" && message.blocks
        ? { ...message, blocks: finalizeRunningToolBlocks(message.blocks) }
        : message,
    ),
  };
}

type RuntimeOwnershipStatus = { active?: boolean; piSessionId?: string | null };

/** Core ownership match: does this runtime status snapshot claim the given pi
 *  session? True when the runtime has not bound a piSessionId yet, when the
 *  caller has none to compare against (a fresh session whose id has not landed
 *  locally), or when the two ids agree. What a MISSING status snapshot means is
 *  deliberately not decided here — that policy differs per caller, and each
 *  exported wrapper below pins down its own answer. */
function runtimeClaimsPiSession(
  status: RuntimeOwnershipStatus,
  piSessionId: string | null | undefined,
): boolean {
  return !status.piSessionId || !piSessionId || status.piSessionId === piSessionId;
}

/** Whether a runtime status snapshot says the session can take a steer or a
 *  follow-up right now.
 *
 *  A MISSING status means "we could not tell", not "no". The probe reads
 *  `/api/agent/runtime/status`, and its loader collapses every timeout, 404,
 *  decode miss and network blip into null; treating that as a refusal drops the
 *  message into the fresh-prompt path mid-turn, which the server then converts
 *  back into a steer anyway — so the user sees their queued message vanish into
 *  the transcript instead. The turn API is the real authority and rejects with
 *  409 if the session is not actually controllable, so fail open here.
 *
 *  Truth table:
 *    status missing      → true   (fail open — see above)
 *    status.active falsy → false  (the runtime answered: nothing is running)
 *    otherwise           → runtimeClaimsPiSession(status, piSessionId) */
export function runtimeStatusAcceptsControl(
  status: RuntimeOwnershipStatus | null,
  piSessionId?: string | null,
): boolean {
  if (!status) return true;
  if (!status.active) return false;
  return runtimeClaimsPiSession(status, piSessionId);
}

/** Whether a LIVE runtime is provably serving this pi session, so callers may
 *  act on the probe itself — merge the runtime's buffered events into a
 *  canonical-session hydration, or recover a failed submit as a still-running
 *  turn.
 *
 *  The opposite null policy from `runtimeStatusAcceptsControl`, on purpose:
 *  here the probe result is the evidence acted upon, not a veto, so a probe
 *  that came back empty must count as "no" — guessing "yes" would splice a
 *  stranger runtime's buffer into the transcript or mark a dead session
 *  running, while declining only skips a merge the SSE reattach recovers.
 *
 *  Truth table:
 *    status missing         → false  (fail closed — see above)
 *    status.active !== true → false
 *    otherwise              → runtimeClaimsPiSession(status, piSessionId) */
export function runtimeCanHydrateCanonicalSession(
  status: RuntimeOwnershipStatus | null | undefined,
  piSessionId: string | null | undefined,
): boolean {
  return status?.active === true && runtimeClaimsPiSession(status, piSessionId);
}
