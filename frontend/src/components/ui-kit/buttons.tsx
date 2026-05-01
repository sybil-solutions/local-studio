"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ── IconButton ────────────────────────────────────────────
// Replaces the most duplicated pattern in the app:
//   p-1.5 rounded hover:bg-background  (13+ instances)

type IconButtonSize = "sm" | "md" | "lg";
type IconButtonTone = "neutral" | "danger" | "success";

const iconButtonBase = {
  sm: "p-1 rounded",
  md: "p-1.5 rounded",
  lg: "p-2 rounded-lg",
} satisfies Record<IconButtonSize, string>;

const iconButtonHover = {
  neutral: "hover:bg-background",
  danger: "hover:bg-background text-(--err)",
  success: "hover:bg-background text-(--hl2)",
} satisfies Record<IconButtonTone, string>;

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  children: ReactNode;
}

export function IconButton({
  label,
  size = "md",
  tone = "neutral",
  children,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cx(iconButtonBase[size], iconButtonHover[tone], className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Button ─────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const buttonBase =
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-40";

const buttonVariant = {
  primary:
    "rounded-lg bg-(--accent)/15 text-(--accent) hover:bg-(--accent)/25",
  secondary:
    "rounded-lg border border-(--border)/40 text-(--dim) hover:bg-(--fg)/[0.06] hover:text-(--fg)",
  ghost:
    "rounded-lg text-(--dim) hover:bg-(--fg)/[0.06] hover:text-(--fg)",
  danger:
    "rounded-lg text-(--err) hover:bg-(--err)/15",
} satisfies Record<ButtonVariant, string>;

const buttonSize = {
  sm: "px-2.5 py-1 text-[12px]",
  md: "px-3 py-2 text-[13px]",
} satisfies Record<ButtonSize, string>;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cx(buttonBase, buttonVariant[variant], buttonSize[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
}
