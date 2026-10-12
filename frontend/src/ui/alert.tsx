"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "@/ui/icon-registry";

type AlertVariant = "info" | "success" | "warning" | "error";

interface AlertProps {
  variant?: AlertVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const variantConfig: Record<AlertVariant, { iconClass: string; DefaultIcon: typeof Info }> = {
  info: {
    iconClass: "text-(--ui-info)",
    DefaultIcon: Info,
  },
  success: {
    iconClass: "text-(--ui-success)",
    DefaultIcon: CheckCircle2,
  },
  warning: {
    iconClass: "text-(--ui-warning)",
    DefaultIcon: TriangleAlert,
  },
  error: {
    iconClass: "text-(--ui-danger)",
    DefaultIcon: AlertCircle,
  },
};

function Alert({ variant = "info", icon, children, className = "" }: AlertProps) {
  const config = variantConfig[variant];
  const IconComponent = config.DefaultIcon;
  const live = variant === "error" ? "assertive" : variant === "info" ? undefined : "polite";

  return (
    <div
      role={variant === "error" ? "alert" : live ? "status" : undefined}
      aria-live={live}
      className={`rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--color-surface) px-3 py-2.5 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 shrink-0 ${config.iconClass}`}>
          {icon || <IconComponent className="h-4 w-4" />}
        </div>
        <div className="text-[length:var(--fs-sm)] leading-relaxed text-(--ui-fg)/85">
          {children}
        </div>
      </div>
    </div>
  );
}

export { Alert };
export type { AlertProps, AlertVariant };
