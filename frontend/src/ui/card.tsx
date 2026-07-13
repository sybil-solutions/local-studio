"use client";

import type { ReactNode } from "react";

type CardPadding = "sm" | "md" | "lg";

interface CardProps {
  padding?: CardPadding;
  children: ReactNode;
  className?: string;
  bordered?: boolean;
  title?: ReactNode;
  description?: ReactNode;
}

const paddingClasses: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

function CardHeading({ title, description }: Pick<CardProps, "title" | "description">) {
  if (!title && !description) return null;
  return (
    <div className="mb-3 space-y-1">
      {title ? (
        <h2 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{title}</h2>
      ) : null}
      {description ? (
        <p className="text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function Card({
  padding = "md",
  children,
  className = "",
  bordered = true,
  title,
  description,
}: CardProps) {
  return (
    <div
      className={`rounded-[var(--rad-lg)] bg-(--ui-surface) ${bordered ? "border border-(--ui-border)" : ""} ${paddingClasses[padding]} ${className}`}
    >
      <CardHeading title={title} description={description} />
      {children}
    </div>
  );
}

export { Card };
export type { CardProps, CardPadding };
