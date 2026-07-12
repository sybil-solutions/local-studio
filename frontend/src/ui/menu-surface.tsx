import type { ComponentPropsWithRef } from "react";
import { cx } from "./utils";

export type MenuElevation = "menu" | "menu-sm" | "menu-lg" | "dropdown" | "modal";

const elevationClass: Record<MenuElevation, string> = {
  menu: "shadow-(--shadow-menu)",
  "menu-sm": "shadow-(--shadow-menu-sm)",
  "menu-lg": "shadow-(--shadow-menu-lg)",
  dropdown: "shadow-(--shadow-dropdown)",
  modal: "shadow-(--shadow-modal)",
};

export type MenuSurfaceProps = ComponentPropsWithRef<"div"> & {
  elevation?: MenuElevation;
};

export function MenuSurface({
  elevation = "menu",
  className,
  children,
  ...rest
}: MenuSurfaceProps) {
  return (
    <div
      className={cx(
        "border border-(--color-popover-border) bg-(--color-popover)",
        elevationClass[elevation],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
