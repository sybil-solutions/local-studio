import type { AppContext } from "../../app-context";
import { observeControllerFunction } from "../../core/function-observability";

export const createGetObservedProcess =
  (
    context: AppContext,
  ): ((label: string) => ReturnType<AppContext["engineService"]["getCurrentProcess"]>) =>
  (label: string) =>
    observeControllerFunction(context, `${label}.getCurrentProcess`, () =>
      context.engineService.getCurrentProcess(),
    );
