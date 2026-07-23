"use client";

import type { ReactNode } from "react";
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader, DrawerOverlay } from "./drawer";
import { cx } from "./utils";

export function ResourceDrawer({
  title,
  icon,
  badge,
  status,
  footer,
  onClose,
  children,
  width = 620,
}: {
  title: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  status?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <DrawerOverlay onClose={onClose}>
      <Drawer width={width}>
        <DrawerHeader title={title} icon={icon} badge={badge} onClose={onClose} />
        <DrawerBody>{children}</DrawerBody>
        {status || footer ? <DrawerFooter status={status}>{footer}</DrawerFooter> : null}
      </Drawer>
    </DrawerOverlay>
  );
}

export function ResourceDrawerSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <div className="mb-2">
        <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            {description}
          </p>
        ) : null}
      </div>
      <div className="divide-y divide-(--ui-separator) border-y border-(--ui-separator)">
        {children}
      </div>
    </section>
  );
}

export function ResourceFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-2.5 text-[length:var(--fs-sm)]">
      <span className="text-(--ui-muted)">{label}</span>
      <span className={cx("min-w-0 break-words text-(--ui-fg)", mono ? "font-mono" : "")}>
        {value}
      </span>
    </div>
  );
}
