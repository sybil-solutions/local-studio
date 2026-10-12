"use client";

import { formatRelativeTime } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import {
  DataRow,
  ExpandText,
  GroupRow,
  HeadCell,
  LeadCell,
  TableFrame,
  TableNotice,
} from "@/features/recipes/recipes-content/catalog-table-shell";

type ErrorRow = {
  key: string;
  createdAt: string;
  source: string;
  method: string | null;
  status: number | null;
  errorClass: string | null;
  message: string | null;
};

const byNewest = (a: ErrorRow, b: ErrorRow): number => b.createdAt.localeCompare(a.createdAt);

/**
 * The failures, with their messages.
 *
 * A success rate tells you something is wrong; it never tells you what. These
 * rows are the only place in the product where the controller's own error text
 * is legible, so the message column is the widest one and the timestamps are
 * relative — "4 min ago" is what you need when you are deciding whether the
 * thing you just did caused this.
 */
export function UsageErrorsTab({ stats }: { stats: UsageStats }) {
  const controller = stats.controller;

  const requestErrors: ErrorRow[] = (controller?.recent_errors ?? [])
    .map((error, index) => ({
      key: `request-${index}-${error.created_at}`,
      createdAt: error.created_at,
      source: error.path,
      method: error.method || null,
      status: error.status || null,
      errorClass: error.error_class,
      message: error.error_message,
    }))
    .sort(byNewest);

  const toolErrors: ErrorRow[] = (controller?.function_calls?.recent_errors ?? [])
    .map((error, index) => ({
      key: `tool-${index}-${error.created_at}`,
      createdAt: error.created_at,
      source: error.function_name,
      method: null,
      status: null,
      errorClass: error.error_class,
      message: error.error_message,
    }))
    .sort(byNewest);

  if (requestErrors.length === 0 && toolErrors.length === 0) {
    return (
      <TableNotice
        title="No recorded errors"
        body="The controller has not logged a failed request or tool call in its retention window. If something is failing anyway, it is failing before it reaches the controller."
      />
    );
  }

  const groups = [
    {
      label: "Request errors",
      blurb: "HTTP requests the controller could not serve",
      rows: requestErrors,
    },
    {
      label: "Tool-call errors",
      blurb: "tools the agent runtime invoked that threw",
      rows: toolErrors,
    },
  ].filter((group) => group.rows.length > 0);

  return (
    <TableFrame minWidthClass="min-w-[56rem]">
      <thead>
        <tr>
          <HeadCell>When</HeadCell>
          <HeadCell>Source</HeadCell>
          <HeadCell>Status</HeadCell>
          <HeadCell>Class</HeadCell>
          <HeadCell>Message</HeadCell>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.label}>
          <GroupRow
            colSpan={5}
            label={group.label}
            blurb={group.blurb}
            right={`${group.rows.length} recorded`}
          />
          {group.rows.map((row) => (
            <DataRow key={row.key} className="align-top">
              <LeadCell>
                <span
                  className="whitespace-nowrap text-[length:var(--fs-sm)] text-(--dim)"
                  title={row.createdAt}
                >
                  {formatRelativeTime(row.createdAt)}
                </span>
              </LeadCell>
              <td className="px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {row.method ? (
                    <span className="shrink-0 rounded bg-(--ui-hover) px-1.5 py-px font-mono text-[length:var(--fs-2xs)] text-(--dim)">
                      {row.method}
                    </span>
                  ) : null}
                  <span
                    className="min-w-0 truncate font-mono text-[length:var(--fs-sm)] text-(--fg)"
                    title={row.source}
                  >
                    {row.source || "unknown"}
                  </span>
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {row.status ? (
                  <span className="rounded bg-(--err)/12 px-1.5 py-px font-mono text-[length:var(--fs-2xs)] text-(--err)">
                    {row.status}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <span className="text-[length:var(--fs-sm)] text-(--dim)">
                  {row.errorClass ?? "—"}
                </span>
              </td>
              <td className="rounded-r-lg px-3 py-2">
                {row.message ? (
                  <ExpandText text={row.message} />
                ) : (
                  <span className="text-[length:var(--fs-xs)] text-(--dim)/60">
                    no message recorded
                  </span>
                )}
              </td>
            </DataRow>
          ))}
        </tbody>
      ))}
    </TableFrame>
  );
}
