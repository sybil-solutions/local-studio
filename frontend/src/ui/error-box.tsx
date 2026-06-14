"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded border border-(--ui-danger)/30 bg-(--ui-danger)/10 px-3 py-2 text-xs text-(--ui-danger)",
        className,
      )}
    >
      {children}
    </div>
  );
}
