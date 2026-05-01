import { createStateMachine, type StateMachineContainer } from "../../shared/state-machine";
import type { DownloadFileInfo } from "../types";

// ── States ────────────────────────────────────────────────────────────────
export type DownloadState =
  | "idle"
  | "queued"
  | "downloading"
  | "verifying"
  | "ready"
  | "error"
  | "paused"
  | "canceled";

export interface DownloadMachineSnapshot {
  state: DownloadState;
  downloadId: string | null;
  modelId: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  currentFile: string | null;
  files: DownloadFileInfo[];
}

// ── Events ────────────────────────────────────────────────────────────────
export type DownloadMachineEvent =
  | { type: "START"; downloadId: string; modelId: string; destination: string; files: DownloadFileInfo[] }
  | { type: "PROGRESS"; bytes: number; total: number | null; currentFile: string }
  | { type: "VERIFY_START" }
  | { type: "VERIFY_PASS" }
  | { type: "VERIFY_FAIL"; reason: string }
  | { type: "CANCEL" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "ERROR"; reason: string }
  | { type: "FILE_COMPLETE"; path: string };

// ── Effects ───────────────────────────────────────────────────────────────
export type DownloadMachineEffect =
  | { type: "FETCH_FILE_LIST"; modelId: string }
  | { type: "DOWNLOAD_FILE"; url: string; destination: string }
  | { type: "VERIFY_CHECKSUM"; path: string }
  | { type: "EMIT_EVENT"; event: string; payload: Record<string, unknown> }
  | { type: "STORE_PROGRESS"; downloadedBytes: number; totalBytes: number | null }
  | { type: "LOG"; level: string; message: string; meta?: Record<string, unknown> };

type TransitionFn = (
  state: DownloadMachineSnapshot,
  event: DownloadMachineEvent,
) => {
  state: DownloadMachineSnapshot;
  effects: DownloadMachineEffect[];
};

const transition: TransitionFn = (current, event) => {
  const effects: DownloadMachineEffect[] = [];

  switch (current.state) {
    // ── idle ──
    case "idle": {
      if (event.type === "START") {
        return {
          state: {
            ...current,
            state: "queued",
            downloadId: event.downloadId,
            modelId: event.modelId,
            files: event.files,
            downloadedBytes: 0,
            totalBytes: null,
            error: null,
            currentFile: null,
          },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: event.downloadId, status: "queued" } },
          ],
        };
      }
      break;
    }

    // ── queued ──
    case "queued": {
      if (event.type === "CANCEL") {
        return {
          state: { ...current, state: "canceled", error: null },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "canceled" } },
          ],
        };
      }
      // Starting download
      if (event.type === "PROGRESS") {
        return {
          state: {
            ...current,
            state: "downloading",
            downloadedBytes: event.bytes,
            totalBytes: event.total,
            currentFile: event.currentFile,
          },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "downloading" } },
          ],
        };
      }
      break;
    }

    // ── downloading ──
    case "downloading": {
      if (event.type === "CANCEL") {
        return {
          state: { ...current, state: "canceled" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "canceled" } },
          ],
        };
      }
      if (event.type === "PAUSE") {
        return {
          state: { ...current, state: "paused" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "paused" } },
            { type: "STORE_PROGRESS", downloadedBytes: current.downloadedBytes, totalBytes: current.totalBytes },
          ],
        };
      }
      if (event.type === "PROGRESS") {
        return {
          state: {
            ...current,
            downloadedBytes: event.bytes,
            totalBytes: event.total,
            currentFile: event.currentFile,
          },
          effects: [
            { type: "EMIT_EVENT", event: "download_progress", payload: { id: current.downloadId, downloadedBytes: event.bytes, totalBytes: event.total, currentFile: event.currentFile } },
            { type: "STORE_PROGRESS", downloadedBytes: event.bytes, totalBytes: event.total },
          ],
        };
      }
      if (event.type === "ERROR") {
        return {
          state: { ...current, state: "error", error: event.reason },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "error", error: event.reason } },
          ],
        };
      }
      if (event.type === "FILE_COMPLETE") {
        return {
          state: { ...current, currentFile: event.path },
          effects: [
            { type: "EMIT_EVENT", event: "download_progress", payload: { id: current.downloadId, fileComplete: event.path } },
          ],
        };
      }
      if (event.type === "VERIFY_START") {
        return {
          state: { ...current, state: "verifying" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "verifying" } },
          ],
        };
      }
      break;
    }

    // ── verifying ──
    case "verifying": {
      if (event.type === "VERIFY_PASS") {
        return {
          state: { ...current, state: "ready", error: null },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "completed" } },
          ],
        };
      }
      if (event.type === "VERIFY_FAIL") {
        return {
          state: { ...current, state: "error", error: event.reason },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "error", error: event.reason } },
          ],
        };
      }
      if (event.type === "CANCEL") {
        return {
          state: { ...current, state: "canceled" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "canceled" } },
          ],
        };
      }
      break;
    }

    // ── paused ──
    case "paused": {
      if (event.type === "RESUME") {
        return {
          state: { ...current, state: "queued" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "queued" } },
          ],
        };
      }
      if (event.type === "CANCEL") {
        return {
          state: { ...current, state: "canceled" },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "canceled" } },
          ],
        };
      }
      break;
    }

    // ── ready ──
    case "ready": {
      // Terminal state, no transitions
      break;
    }

    // ── error ──
    case "error": {
      if (event.type === "RESUME") {
        return {
          state: { ...current, state: "queued", error: null },
          effects: [
            { type: "EMIT_EVENT", event: "download_state", payload: { id: current.downloadId, status: "queued" } },
          ],
        };
      }
      break;
    }

    // ── canceled ──
    case "canceled": {
      // Terminal state
      break;
    }
  }

  return { state: current, effects };
};

export type DownloadMachine = StateMachineContainer<
  DownloadMachineSnapshot,
  DownloadMachineEvent,
  undefined,
  DownloadMachineEffect
>;

export const createDownloadMachine = (): DownloadMachine => {
  return createStateMachine<
    DownloadMachineSnapshot,
    DownloadMachineEvent,
    undefined,
    DownloadMachineEffect
  >({
    initialState: {
      state: "idle",
      downloadId: null,
      modelId: null,
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      currentFile: null,
      files: [],
    },
    transition: (state, _ctx, event) => {
      return transition(state, event);
    },
  });
};