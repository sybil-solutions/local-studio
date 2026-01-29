// CRITICAL
"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AgentFileEntry } from "@/lib/types";
import { useAppStore } from "@/store";

export function useAgentFiles() {
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const agentFiles = useAppStore((state) => state.agentFiles);
  const agentFilesLoading = useAppStore((state) => state.agentFilesLoading);
  const setAgentFiles = useAppStore((state) => state.setAgentFiles);
  const setAgentFilesLoading = useAppStore((state) => state.setAgentFilesLoading);

  const resolveSessionId = (sessionIdOverride?: string | null) =>
    sessionIdOverride ?? currentSessionId;

  const loadAgentFiles = useCallback(
    async (options?: {
      sessionId?: string | null;
      path?: string;
      recursive?: boolean;
    }): Promise<AgentFileEntry[]> => {
      const sessionId = resolveSessionId(options?.sessionId);
      console.log("[loadAgentFiles] sessionId:", sessionId, "options:", options);
      if (!sessionId) {
        console.log("[loadAgentFiles] No sessionId, returning empty");
        setAgentFiles([]);
        setAgentFilesLoading(false);
        return [];
      }
      setAgentFilesLoading(true);
      try {
        console.log("[loadAgentFiles] Calling API...");
        const data = await api.getAgentFiles(sessionId, {
          path: options?.path,
          recursive: options?.recursive,
        });
        console.log("[loadAgentFiles] API response:", data);
        const files = Array.isArray(data.files) ? data.files : [];
        console.log("[loadAgentFiles] Setting files in store:", files.length, "files");
        setAgentFiles(files);
        return files;
      } catch (err) {
        // Log error for debugging
        console.error("[loadAgentFiles] Error:", err);
        setAgentFiles([]);
        return [];
      } finally {
        setAgentFilesLoading(false);
      }
    },
    [currentSessionId, setAgentFiles, setAgentFilesLoading],
  );

  const readAgentFile = useCallback(
    async (path: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        throw new Error("No active session");
      }
      return api.readAgentFile(sessionId, path);
    },
    [currentSessionId],
  );

  const writeAgentFile = useCallback(
    async (path: string, content: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      console.log("[writeAgentFile] sessionId:", sessionId, "path:", path, "content length:", content.length);
      if (!sessionId) {
        console.error("[writeAgentFile] No active session!");
        throw new Error("No active session");
      }
      console.log("[writeAgentFile] Calling API...");
      const result = await api.writeAgentFile(sessionId, path, { content });
      console.log("[writeAgentFile] API result:", result);
      console.log("[writeAgentFile] Reloading files...");
      const files = await loadAgentFiles({ sessionId });
      console.log("[writeAgentFile] Files after reload:", files);
      return result;
    },
    [currentSessionId, loadAgentFiles],
  );

  const deleteAgentFile = useCallback(
    async (path: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        throw new Error("No active session");
      }
      const result = await api.deleteAgentFile(sessionId, path);
      await loadAgentFiles({ sessionId });
      return result;
    },
    [currentSessionId, loadAgentFiles],
  );

  const createAgentDirectory = useCallback(
    async (path: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        throw new Error("No active session");
      }
      const result = await api.createAgentDirectory(sessionId, path);
      await loadAgentFiles({ sessionId });
      return result;
    },
    [currentSessionId, loadAgentFiles],
  );

  const moveAgentFile = useCallback(
    async (from: string, to: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        throw new Error("No active session");
      }
      const result = await api.moveAgentFile(sessionId, from, to);
      await loadAgentFiles({ sessionId });
      return result;
    },
    [currentSessionId, loadAgentFiles],
  );

  const clearAgentFiles = useCallback(() => {
    setAgentFiles([]);
    setAgentFilesLoading(false);
  }, [setAgentFiles, setAgentFilesLoading]);

  return {
    agentFiles,
    agentFilesLoading,
    loadAgentFiles,
    readAgentFile,
    writeAgentFile,
    deleteAgentFile,
    createAgentDirectory,
    moveAgentFile,
    clearAgentFiles,
  };
}
