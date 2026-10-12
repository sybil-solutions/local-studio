import { HttpStatus } from "../../core/errors";
import type { LaunchFailure } from "./contracts";

/**
 * The only two renderings a LaunchFailure has. Every HTTP status and every SSE stage is
 * derived here from the tagged union — never from substring-matching an error message,
 * which is how the old path turned any message containing "cancelled" into a 400.
 */

const messageOf = (failure: LaunchFailure): string => {
  switch (failure.kind) {
    case "unsupported":
      return `${failure.engine} cannot run here: ${failure.reason}`;
    case "already-running":
      return `${failure.name} is already running`;
    case "no-capacity":
      return `needs ${failure.need} device(s); only ${failure.free} free`;
    case "install-failed":
      return `${failure.engine} install failed: ${failure.detail}`;
    case "spawn-failed":
      return failure.detail;
    case "exited-early":
      return `process exited (code ${failure.exitCode ?? "?"}${
        failure.signal ? `, signal ${failure.signal}` : ""
      })\n${failure.logTail}`.trim();
    case "unhealthy-timeout":
      return `not healthy after ${Math.round(failure.waitedMs / 1000)}s\n${failure.logTail}`.trim();
    case "cancelled":
      return "launch cancelled";
  }
};

const statusOf = (failure: LaunchFailure): number => {
  switch (failure.kind) {
    case "unsupported":
      return 422;
    case "already-running":
    case "no-capacity":
      return 409;
    case "cancelled":
      return 400;
    case "install-failed":
    case "spawn-failed":
    case "exited-early":
    case "unhealthy-timeout":
      return 503;
  }
};

export const toHttp = (failure: LaunchFailure): HttpStatus =>
  new HttpStatus({ status: statusOf(failure), detail: messageOf(failure) });

export interface LaunchEvent {
  readonly stage: "error" | "cancelled";
  readonly message: string;
}

export const toEvent = (failure: LaunchFailure): LaunchEvent => ({
  stage: failure.kind === "cancelled" ? "cancelled" : "error",
  message: messageOf(failure),
});
