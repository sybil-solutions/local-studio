/**
 * Sidebar toggle glyphs.
 *
 * Lucide ships `Panel{Left,Right}{Open,Close}`, but at 14px the chevron inside
 * the box turns to mush and the open/closed states are nearly indistinguishable.
 * These say the same thing with fill instead: the panel's strip is solid when it
 * is open, hollow when it is closed. Stroked 24px geometry so they sit correctly
 * beside the lucide icons that share the same toolbars.
 */
import type { SVGProps } from "react";

type PanelToggleProps = SVGProps<SVGSVGElement> & { strokeWidth?: number };

function PanelToggle({
  side,
  filled,
  strokeWidth = 1.75,
  ...rest
}: PanelToggleProps & { side: "left" | "right"; filled: boolean }) {
  // The filled strip is a path rather than a rect so it follows the frame's
  // rounded outer corners instead of squaring them off.
  const divider = side === "left" ? "M9 3v18" : "M15 3v18";
  const strip =
    side === "left"
      ? "M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4z"
      : "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z";
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={divider} />
      {filled ? <path d={strip} fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

/** Left panel is open — clicking collapses it. */
export function PanelLeftFilled(props: PanelToggleProps) {
  return <PanelToggle side="left" filled {...props} />;
}

/** Left panel is collapsed — clicking opens it. */
export function PanelLeftHollow(props: PanelToggleProps) {
  return <PanelToggle side="left" filled={false} {...props} />;
}

/** Right panel is open — clicking hides it. */
export function PanelRightFilled(props: PanelToggleProps) {
  return <PanelToggle side="right" filled {...props} />;
}

/** Right panel is hidden — clicking shows it. */
export function PanelRightHollow(props: PanelToggleProps) {
  return <PanelToggle side="right" filled={false} {...props} />;
}
