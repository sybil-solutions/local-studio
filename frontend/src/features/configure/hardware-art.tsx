"use client";

import type { ReactNode } from "react";
import type { RigHardwareType } from "@/lib/types";
import { cx } from "@/ui/utils";

const GRILLE_DOTS = (() => {
  const dots: Array<{ x: number; y: number }> = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      dots.push({ x: 34 + col * 6.5, y: 26 + row * 6.5 });
    }
  }
  return dots;
})();

const ART_BY_TYPE: Record<RigHardwareType, ReactNode> = {
  "dgx-spark": (
    <>
      <rect x="26" y="16" width="68" height="48" rx="9" />
      {GRILLE_DOTS.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r="1.4"
          fill="currentColor"
          stroke="none"
          opacity="0.55"
        />
      ))}
      <rect x="34" y="57" width="14" height="2.5" rx="1.25" fill="var(--ui-accent)" stroke="none" />
    </>
  ),
  "gpu-desktop": (
    <>
      <rect x="38" y="8" width="44" height="64" rx="5" />
      <rect x="44" y="14" width="32" height="34" rx="3" opacity="0.5" />
      <rect
        x="47"
        y="24"
        width="26"
        height="6"
        rx="2"
        fill="var(--ui-accent)"
        stroke="none"
        opacity="0.9"
      />
      <rect
        x="47"
        y="34"
        width="26"
        height="6"
        rx="2"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
      <circle cx="60" cy="60" r="3.5" />
      <line x1="44" y1="53" x2="76" y2="53" opacity="0.4" />
    </>
  ),
  "gpu-server": (
    <>
      <rect x="14" y="18" width="92" height="20" rx="3" />
      <rect x="14" y="42" width="92" height="20" rx="3" />
      {[0, 1].map((unit) => (
        <g key={unit}>
          {[0, 1, 2, 3, 4, 5].map((vent) => (
            <line
              key={vent}
              x1={22 + vent * 9}
              y1={24 + unit * 24}
              x2={22 + vent * 9}
              y2={32 + unit * 24}
              opacity="0.45"
            />
          ))}
          <circle cx="94" cy={28 + unit * 24} r="2" fill="var(--ui-accent)" stroke="none" />
          <circle
            cx="86"
            cy={28 + unit * 24}
            r="2"
            fill="currentColor"
            stroke="none"
            opacity="0.35"
          />
        </g>
      ))}
    </>
  ),
  mac: (
    <>
      <rect x="30" y="18" width="60" height="44" rx="11" />
      <circle cx="60" cy="40" r="11" opacity="0.45" />
      <circle cx="60" cy="40" r="4" fill="var(--ui-accent)" stroke="none" opacity="0.9" />
      <line x1="42" y1="56" x2="50" y2="56" opacity="0.5" />
      <line x1="54" y1="56" x2="62" y2="56" opacity="0.5" />
    </>
  ),
  laptop: (
    <>
      <rect x="32" y="14" width="56" height="38" rx="4" />
      <rect x="37" y="19" width="46" height="28" rx="2" opacity="0.45" />
      <path d="M24 60 L32 52 L88 52 L96 60 Z" />
      <line x1="52" y1="56" x2="68" y2="56" opacity="0.6" />
    </>
  ),
  "mini-pc": (
    <>
      <rect x="28" y="28" width="64" height="26" rx="6" />
      {[0, 1, 2, 3].map((vent) => (
        <line key={vent} x1={38 + vent * 12} y1="34" x2={38 + vent * 12} y2="48" opacity="0.45" />
      ))}
      <circle cx="86" cy="41" r="2.5" fill="var(--ui-accent)" stroke="none" />
    </>
  ),
  custom: (
    <>
      <rect x="42" y="22" width="36" height="36" rx="5" />
      <rect x="50" y="30" width="20" height="20" rx="2" opacity="0.5" />
      {[0, 1, 2].map((pin) => (
        <g key={pin}>
          <line x1={50 + pin * 10} y1="14" x2={50 + pin * 10} y2="22" />
          <line x1={50 + pin * 10} y1="58" x2={50 + pin * 10} y2="66" />
          <line x1="34" y1={30 + pin * 10} x2="42" y2={30 + pin * 10} />
          <line x1="78" y1={30 + pin * 10} x2="86" y2={30 + pin * 10} />
        </g>
      ))}
      <circle cx="60" cy="40" r="3" fill="var(--ui-accent)" stroke="none" />
    </>
  ),
};

export function HardwareArt({ type, className }: { type: RigHardwareType; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 80"
      role="img"
      aria-label={type}
      className={cx("text-(--ui-fg)", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ART_BY_TYPE[type]}
    </svg>
  );
}
