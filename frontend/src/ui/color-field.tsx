"use client";

import { cx } from "./utils";

/** Normalize any CSS color string to a 6-digit hex the native picker accepts. */
function toHex6(value: string): string {
  if (typeof document === "undefined") return "#000000";
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = value;
  return ctx.fillStyle as string;
}

/** Pick a legible text color (black/white) for a given background hex. */
function readableText(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return "#ffffff";
  const n = Number.parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#1a1a1a" : "#ffffff";
}

/**
 * A color value rendered as a filled pill (background = the color) with its hex
 * and a leading dot; clicking anywhere opens the native color picker.
 */
export function ColorField({
  value,
  onChange,
  label = "Pick color",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  className?: string;
}) {
  const hex = toHex6(value);
  const pickerValue = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
  const textColor = readableText(hex);
  return (
    <label
      className={cx(
        "relative inline-flex h-7 w-full max-w-[184px] cursor-pointer items-center justify-between gap-2 overflow-hidden rounded-md border border-(--ui-border) px-2.5",
        className,
      )}
      style={{ backgroundColor: value }}
      title={value}
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/25"
        style={{ backgroundColor: value }}
      />
      <span
        className="font-mono text-[length:var(--fs-md)] uppercase tabular-nums"
        style={{ color: textColor }}
      >
        {hex}
      </span>
      <input
        type="color"
        value={pickerValue}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}
