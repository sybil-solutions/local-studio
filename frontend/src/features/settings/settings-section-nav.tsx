"use client";

import type { ReactNode } from "react";
import { cx } from "@/ui/utils";
import type { SectionNavItem } from "@/ui/page";

export type SettingsNavGroup<Id extends string = string> = {
  label: string;
  items: SectionNavItem<Id>[];
};

/**
 * Settings section rail — grouped and styled like the app sidebar, not a grid
 * of chips. The generic SectionNav lived in ui/ for one caller and read wrong
 * on mobile (two-column wrap) and desktop (14 undifferentiated rows).
 */
export function SettingsSectionNav<Id extends string = string>({
  label,
  groups,
  activeItem,
  onSelectItem,
}: {
  label: string;
  groups: SettingsNavGroup<Id>[];
  activeItem: Id;
  onSelectItem: (item: Id) => void;
}) {
  return (
    <nav aria-label={label} className="min-w-0">
      {/* Phone: one scroll row of section pills. Desktop: grouped vertical rail. */}
      <div className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
        {groups.flatMap((group) =>
          group.items.map((item) => (
            <SettingsNavButton
              key={item.id}
              item={item}
              active={activeItem === item.id}
              onSelect={() => onSelectItem(item.id)}
              compact
            />
          )),
        )}
      </div>

      <div className="hidden flex-col gap-4 lg:flex">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[length:var(--fs-xs)] font-medium tracking-wide text-(--ui-muted)/80 uppercase">
              {group.label}
            </div>
            <div className="flex flex-col gap-px">
              {group.items.map((item) => (
                <SettingsNavButton
                  key={item.id}
                  item={item}
                  active={activeItem === item.id}
                  onSelect={() => onSelectItem(item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function SettingsNavButton<Id extends string>({
  item,
  active,
  onSelect,
  compact,
}: {
  item: SectionNavItem<Id>;
  active: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={item.description}
      aria-current={active ? "page" : undefined}
      className={cx(
        "group flex shrink-0 items-center gap-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35",
        compact
          ? cx(
              "h-8 rounded-full px-3 text-[length:var(--fs-sm)]",
              active
                ? "bg-(--active) font-medium text-(--fg)"
                : "bg-(--ui-hover)/40 text-(--ui-muted) hover:text-(--fg)",
            )
          : cx(
              "h-[var(--sidebar-row-height)] w-full rounded-[var(--sidebar-row-radius)] px-2 text-[length:var(--fs-md)]",
              active
                ? "bg-(--active) font-medium text-(--fg)"
                : "text-(--fg)/80 hover:bg-(--hover) hover:text-(--fg)",
            ),
      )}
    >
      {item.icon ? (
        <span
          className={cx(
            "flex shrink-0 items-center justify-center",
            compact ? "h-3.5 w-3.5" : "h-4 w-4",
            active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
          )}
        >
          {item.icon}
        </span>
      ) : null}
      <span className={cx("truncate", compact ? "whitespace-nowrap" : "")}>{item.label}</span>
    </button>
  );
}
