import { Effect } from "effect";

export const delayEffect = (ms: number): Effect.Effect<void> => Effect.sleep(ms);

export const delay = (ms: number): Promise<void> => Effect.runPromise(delayEffect(ms));
