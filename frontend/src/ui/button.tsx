"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./utils";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-(--color-primary) text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-(--ui-fg)/5 text-(--ui-fg) hover:bg-(--ui-fg)/10 active:bg-(--ui-fg)/12 disabled:opacity-50",
  danger:
    "bg-(--ui-danger) text-(--destructive-foreground) hover:bg-(--ui-danger)/90 disabled:cursor-not-allowed disabled:opacity-50",
  ghost: "text-(--ui-muted) hover:bg-(--ui-fg)/[0.07] hover:text-(--ui-fg) disabled:opacity-50",
  icon: "text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-[length:var(--fs-sm)]",
  md: "h-8 px-3.5 text-[length:var(--fs-base)]",
  lg: "h-9 px-4 text-[length:var(--fs-base)]",
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
};

const baseClasses =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[transform,color,background-color,border-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) active:scale-[0.98]";

const modelButtonToneClasses = {
  default: "text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)",
  primary: "text-(--ui-fg) hover:bg-(--ui-hover)",
  danger: "text-(--ui-danger) hover:bg-(--ui-danger)/10",
} as const;
const modelButtonBaseClasses =
  "inline-flex h-6 items-center justify-center gap-1.5 rounded-md px-1.5 text-[length:var(--fs-sm)] font-medium transition-[background-color,color,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-45";

export type ModelButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
};

export function ModelButton({
  children,
  tone = "default",
  type = "button",
  ...props
}: ModelButtonProps) {
  return (
    <button
      type={type}
      {...props}
      className={cx(modelButtonBaseClasses, modelButtonToneClasses[tone])}
    >
      {children}
    </button>
  );
}

function buttonClasses(variant: ButtonVariant, size: ButtonSize): string {
  const sClass = variant === "icon" ? iconSizeClasses[size] : sizeClasses[size];
  return `${baseClasses} ${variantClasses[variant]} ${sClass}`;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    children,
    className = "",
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const cls = buttonClasses(variant, size);

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`${cls} ${className}`}
      {...props}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export { Button, buttonClasses };
export type { ButtonProps, ButtonVariant, ButtonSize };
