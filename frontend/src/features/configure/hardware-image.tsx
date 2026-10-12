"use client";

import { useState } from "react";
import type { RigAccelerator, RigNode } from "@/lib/types";
import { cx } from "@/ui/utils";
import { HardwareArt } from "./hardware-art";

/**
 * Product shots for the machines this workspace can talk to.
 *
 * A rig node is a physical object the operator owns and can point at, and the
 * fastest way to confirm "yes, that is the box under my desk" is a picture of
 * it. The files and this id → path map are ported from the local.ai hardware
 * catalog rather than re-derived; `public/images/hardware/ATTRIBUTION.md`
 * travels with them. Anything we have no shot for falls back to the line
 * drawing in `hardware-art`, so a machine never renders a broken image.
 */
const HARDWARE_IMAGE_BY_ID: Record<string, string> = {
  "dgx-spark": "/images/hardware/dgx-spark-single.webp",
  "mac-studio": "/images/hardware/m3-ultra-mac-studio-cutout.webp",
  "macbook-pro": "/images/hardware/m4-max-macbook-pro-cutout.webp",
  "mac-mini": "/images/hardware/m4-pro-mac-mini.webp",
  "rtx-pro-6000": "/images/hardware/rtx-pro-6000.webp",
  "rtx-pro-5000": "/images/hardware/rtx-pro-5000.webp",
  "rtx-6000-ada": "/images/hardware/rtx-6000-ada.webp",
  "rtx-5880-ada": "/images/hardware/rtx-5880-ada.webp",
  "rtx-5000-ada": "/images/hardware/rtx-5000-ada.webp",
  "rtx-4500-ada": "/images/hardware/rtx-4500-ada.webp",
  "rtx-a6000": "/images/hardware/rtx-a6000.webp",
  "rtx-a5000": "/images/hardware/rtx-a5000.webp",
  "rtx-quadro-8000": "/images/hardware/rtx-quadro-8000.webp",
  "rtx-5090": "/images/hardware/rtx-5090.webp",
  "rtx-4090d": "/images/hardware/rtx-4090d.webp",
  "rtx-4090": "/images/hardware/rtx-4090.webp",
  "rtx-3090ti": "/images/hardware/rtx-3090ti.webp",
  "rtx-3090": "/images/hardware/rtx-3090.webp",
};

/**
 * Accelerator name → image id, tried in order.
 *
 * The app only ever learns a GPU by the string the driver reports — there is no
 * vendor or model field anywhere on `RigAccelerator` — so matching is regex
 * over names like "NVIDIA RTX PRO 6000 Blackwell Workstation Edition" and
 * "NVIDIA GeForce RTX 3090". Order is load-bearing: the more specific suffix
 * has to win, or a 3090 Ti renders as a 3090 and a 4090 D as a 4090.
 */
const IMAGE_ID_BY_ACCELERATOR: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bGB10\b|dgx[\s-]*spark/i, "dgx-spark"],
  [/RTX\s*PRO\s*6000/i, "rtx-pro-6000"],
  [/RTX\s*PRO\s*5000/i, "rtx-pro-5000"],
  [/RTX\s*6000\s*Ada/i, "rtx-6000-ada"],
  [/RTX\s*5880\s*Ada/i, "rtx-5880-ada"],
  [/RTX\s*5000\s*Ada/i, "rtx-5000-ada"],
  [/RTX\s*4500\s*Ada/i, "rtx-4500-ada"],
  [/RTX\s*A6000/i, "rtx-a6000"],
  [/RTX\s*A5000/i, "rtx-a5000"],
  [/Quadro\s*RTX\s*8000/i, "rtx-quadro-8000"],
  [/RTX\s*5090/i, "rtx-5090"],
  [/RTX\s*4090\s*D\b/i, "rtx-4090d"],
  [/RTX\s*4090/i, "rtx-4090"],
  [/RTX\s*3090\s*Ti/i, "rtx-3090ti"],
  [/RTX\s*3090/i, "rtx-3090"],
];

/**
 * Apple chip → chassis, tried in order.
 *
 * On Apple Silicon there is no discrete GPU to name: detection synthesizes the
 * accelerator from the CPU model, so "Apple M3 Ultra" is all we get. The chip
 * tier is the only chassis signal in that string, and it is a reliable one —
 * Ultra has only ever shipped in the Mac Studio. `hardware_type` overrides this
 * whenever the operator has told us which box it is.
 */
const CHASSIS_BY_APPLE_CHIP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bM\d+\s*Ultra\b/i, "mac-studio"],
  [/\bM\d+\s*Max\b/i, "macbook-pro"],
  [/\bM\d+\s*Pro\b/i, "mac-mini"],
  [/\bApple\s+M\d+\b/i, "mac-mini"],
];

const matchId = (
  table: ReadonlyArray<readonly [RegExp, string]>,
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
};

/** The accelerator that defines the machine: the one contributing most memory. */
const principalAccelerator = (accelerators: readonly RigAccelerator[]): RigAccelerator | null =>
  accelerators.reduce<RigAccelerator | null>((best, candidate) => {
    if (!best) return candidate;
    const score = (entry: RigAccelerator) => (entry.memory_gb ?? 0) * entry.count;
    return score(candidate) > score(best) ? candidate : best;
  }, null);

/**
 * The image id for a machine, or null when we ship no shot of it.
 *
 * A Spark is identified by chassis first because its accelerator and its box
 * are the same product; an Apple machine by chassis first because the operator
 * knows whether it is a laptop and the chip string does not. Everything else is
 * a tower or a rack whose identity is the card inside it, so the card wins.
 */
export function hardwareImageId(node: RigNode): string | null {
  if (node.hardware_type === "dgx-spark") return "dgx-spark";
  const accelerator = principalAccelerator(node.accelerators);
  const apple =
    matchId(CHASSIS_BY_APPLE_CHIP, accelerator?.name) ??
    matchId(CHASSIS_BY_APPLE_CHIP, node.cpu_model);
  // A chassis the operator has named beats the chip tier's guess at one — and
  // "laptop" or "mini PC" alone says nothing, so a ThinkPad stays a glyph
  // rather than becoming a MacBook.
  if (node.hardware_type === "laptop") return apple ? "macbook-pro" : null;
  if (node.hardware_type === "mini-pc") return apple ? "mac-mini" : null;
  return matchId(IMAGE_ID_BY_ACCELERATOR, accelerator?.name) ?? apple;
}

/**
 * A photo of the machine when we have one, the type's line drawing when we do
 * not.
 *
 * The shots are transparent cutouts framed with slack around the product, so
 * they need to overflow their tile slightly to read at this size — except the
 * Mac mini, which is a wide flat slab that has to shrink instead.
 */
export function MachineImage({ node, className }: { node: RigNode; className?: string }) {
  const imageId = hardwareImageId(node);
  const src = imageId ? HARDWARE_IMAGE_BY_ID[imageId] : null;
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--rad-md)] border border-(--ui-border) bg-(--surface-3)",
        className,
      )}
      aria-hidden
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cx(
            "h-full w-full object-contain",
            imageId === "mac-mini" ? "scale-[0.62]" : "scale-[1.12]",
          )}
        />
      ) : (
        // The tile's 3:2 proportion matches the drawing's 120x80 viewBox, so
        // full-bleed minus a little air keeps its declared 2px strokes near
        // 1.4 device pixels. The old 20px row tile rendered them at 0.3px,
        // which is why this art has been reading as an empty grey square.
        <HardwareArt type={node.hardware_type} className="h-full w-full p-[7%] text-(--dim)" />
      )}
    </span>
  );
}
