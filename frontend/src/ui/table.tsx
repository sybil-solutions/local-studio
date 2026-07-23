"use client";

import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cx } from "./utils";

interface TableProps {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
  bordered?: boolean;
}

interface THeadProps {
  children: ReactNode;
  className?: string;
}

interface TBodyProps {
  children: ReactNode;
  className?: string;
}

interface TRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}

interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
  align?: "left" | "right" | "center";
}

interface TCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children?: ReactNode;
  align?: "left" | "right" | "center";
}

function Table({ children, className = "", tableClassName = "", bordered = true }: TableProps) {
  return (
    <div
      className={cx(
        "overflow-x-auto",
        bordered
          ? "rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface)"
          : "",
        className,
      )}
    >
      <table className={cx("w-full text-left text-[length:var(--fs-base)]", tableClassName)}>
        {children}
      </table>
    </div>
  );
}

function THead({ children, className = "" }: THeadProps) {
  return (
    <thead className={cx("border-b border-(--ui-separator) bg-(--ui-hover)/30", className)}>
      {children}
    </thead>
  );
}

function TBody({ children, className = "" }: TBodyProps) {
  return <tbody className={cx("divide-y divide-(--ui-separator)", className)}>{children}</tbody>;
}

function TRow({ children, className = "", onClick, interactive }: TRowProps) {
  return (
    <tr
      className={cx(
        "transition-colors",
        interactive || onClick
          ? "cursor-pointer hover:bg-(--ui-hover)/60"
          : "hover:bg-(--ui-hover)/25",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

function TH({ children, align = "left", className = "", ...props }: THProps) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      className={cx(
        "px-3 py-2.5 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.08em] text-(--ui-muted)",
        alignClass,
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

function TCell({ children, align = "left", className = "", ...props }: TCellProps) {
  const alignClass =
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td
      className={cx("px-3 py-2.5 text-[length:var(--fs-base)]", alignClass, className)}
      {...props}
    >
      {children}
    </td>
  );
}

export { Table, THead, TBody, TRow, TH, TCell };
export type { TableProps, THeadProps, TBodyProps, TRowProps, THProps, TCellProps };
