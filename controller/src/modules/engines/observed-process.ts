import type { AppContext } from "../../app-context";
import { observeControllerFunction } from "../../core/function-observability";

export const createGetObservedProcess =
  (
    context: AppContext,
  ): ((label: string) => ReturnType<AppContext["compute"]["model"]["findInferenceProcess"]>) =>
  (label: string) =>
    observeControllerFunction(context, `${label}.getCurrentProcess`, () =>
      context.compute.model.findInferenceProcess(),
    );
