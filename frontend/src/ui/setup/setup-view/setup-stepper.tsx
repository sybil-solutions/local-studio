"use client";

import { ChevronRight } from "lucide-react";
import { setupSteps } from "./utils";

export function SetupStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      {setupSteps.map((label, index) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
              index <= step ? "bg-(--hl1) text-white" : "bg-(--surface) text-(--dim)"
            }`}
          >
            {index + 1}
          </div>
          <div className="text-sm text-(--dim)">{label}</div>
          {index < setupSteps.length - 1 && <ChevronRight className="h-4 w-4 text-(--border)" />}
        </div>
      ))}
    </div>
  );
}
