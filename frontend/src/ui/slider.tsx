"use client";

import { cx } from "./utils";

/**
 * A standardized range slider. Uses the platform `accent-color` so the filled
 * track + thumb pick up the theme accent (Chromium/Electron honor this).
 */
export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cx(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-(--ui-fg)/15 outline-none [accent-color:var(--ui-accent)] disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    />
  );
}
