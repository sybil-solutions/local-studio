"use client";

import type { ReactNode } from "react";
import { Checkbox } from "./checkbox";
import { cx } from "./utils";

export function FormSection({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-surface)",
        className,
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b border-(--ui-border) px-3 text-(--ui-fg)">
        {icon ? <span className="text-(--ui-info)">{icon}</span> : null}
        <span className="text-[length:var(--fs-sm)] font-medium">{title}</span>
      </div>
      {children ? <div className="space-y-3 p-3">{children}</div> : null}
    </section>
  );
}

export function CheckboxRow({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-md border border-(--ui-separator) bg-(--ui-bg) p-2.5 transition-colors hover:bg-(--ui-hover)/25",
        className,
      )}
    >
      <Checkbox
        checked={checked}
        onChange={onChange}
        label={label}
        description={description}
        className="items-start"
        labelClassName="text-(--ui-fg)"
      />
    </div>
  );
}
