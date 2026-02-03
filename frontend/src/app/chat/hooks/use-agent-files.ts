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
  const selectedAgentFilePath = useAppStore((state) => state.selectedAgentFilePath);
  const selectedAgentFileContent = useAppStore((state) => state.selectedAgentFileContent);
  const selectedAgentFileLoading = useAppStore((state) => state.selectedAgentFileLoading);
  const setSelectedAgentFilePath = useAppStore((state) => state.setSelectedAgentFilePath);
  const setSelectedAgentFileContent = useAppStore((state) => state.setSelectedAgentFileContent);
  const setSelectedAgentFileLoading = useAppStore((state) => state.setSelectedAgentFileLoading);
  const agentFileVersions = useAppStore((state) => state.agentFileVersions);
  const addAgentFileVersion = useAppStore((state) => state.addAgentFileVersion);
  const moveAgentFileVersions = useAppStore((state) => state.moveAgentFileVersions);
  const clearAgentFileVersions = useAppStore((state) => state.clearAgentFileVersions);

  // Read session ID at execution time to avoid stale closure issues.
  // When tools are called during streaming, the closure value may be stale
  // even though the store has been updated.
  const resolveSessionId = (sessionIdOverride?: string | null) => {
    // Read fresh from store to handle cases where session was just created
    const freshSessionId = useAppStore.getState().currentSessionId;
    return sessionIdOverride || freshSessionId || currentSessionId;
  };

  const loadAgentFiles = useCallback(
    async (options?: {
      sessionId?: string | null;
      path?: string;
      recursive?: boolean;
    }): Promise<AgentFileEntry[]> => {
      const sessionId = resolveSessionId(options?.sessionId);
      if (!sessionId) {
        setAgentFiles([]);
        setAgentFilesLoading(false);
        return [];
      }
      setAgentFilesLoading(true);
      try {
        const data = await api.getAgentFiles(sessionId, {
          path: options?.path,
          recursive: options?.recursive,
        });
        const files = Array.isArray(data.files) ? data.files : [];
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
      if (!path || path.trim() === "") {
        throw new Error("Path is required");
      }
      const data = await api.readAgentFile(sessionId, path);
      if (typeof data.content === "string") {
        addAgentFileVersion(path, data.content);
      }
      return data;
    },
    [currentSessionId, addAgentFileVersion],
  );

  const writeAgentFile = useCallback(
    async (path: string, content: string, sessionIdOverride?: string | null) => {
      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        throw new Error("No active session");
      }
      const result = await api.writeAgentFile(sessionId, path, { content });
      if (typeof content === "string") {
        addAgentFileVersion(path, content);
      }
      const files = await loadAgentFiles({ sessionId });
      return result;
    },
    [currentSessionId, loadAgentFiles, addAgentFileVersion],
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
      moveAgentFileVersions(from, to);
      await loadAgentFiles({ sessionId });
      return result;
    },
    [currentSessionId, loadAgentFiles, moveAgentFileVersions],
  );

  const clearAgentFiles = useCallback(() => {
    setAgentFiles([]);
    setAgentFilesLoading(false);
    setSelectedAgentFilePath(null);
    setSelectedAgentFileContent(null);
    clearAgentFileVersions();
  }, [
    setAgentFiles,
    setAgentFilesLoading,
    setSelectedAgentFilePath,
    setSelectedAgentFileContent,
    clearAgentFileVersions,
  ]);

  const selectAgentFile = useCallback(
    async (path: string | null, sessionIdOverride?: string | null) => {
      // Deselect if null
      if (!path) {
        setSelectedAgentFilePath(null);
        setSelectedAgentFileContent(null);
        return;
      }

      const sessionId = resolveSessionId(sessionIdOverride);
      if (!sessionId) {
        // No session - just show the file is selected but can't load content
        console.warn("[selectAgentFile] No active session, cannot load file content");
        setSelectedAgentFilePath(path);
        setSelectedAgentFileContent(null);
        setSelectedAgentFileLoading(false);
        return;
      }

      // Set path immediately for UI feedback
      setSelectedAgentFilePath(path);
      setSelectedAgentFileLoading(true);

      try {
        const data = await api.readAgentFile(sessionId, path);
        setSelectedAgentFileContent(data.content);
        if (typeof data.content === "string") {
          addAgentFileVersion(path, data.content);
        }
      } catch (err) {
        console.error("[selectAgentFile] Error reading file:", err);
        setSelectedAgentFileContent(null);
      } finally {
        setSelectedAgentFileLoading(false);
      }
    },
    [
      currentSessionId,
      setSelectedAgentFilePath,
      setSelectedAgentFileContent,
      setSelectedAgentFileLoading,
      addAgentFileVersion,
    ],
  );

  const clearSelectedFile = useCallback(() => {
    setSelectedAgentFilePath(null);
    setSelectedAgentFileContent(null);
  }, [setSelectedAgentFilePath, setSelectedAgentFileContent]);

  return {
    agentFiles,
    agentFilesLoading,
    agentFileVersions,
    loadAgentFiles,
    readAgentFile,
    writeAgentFile,
    deleteAgentFile,
    createAgentDirectory,
    moveAgentFile,
    clearAgentFiles,
    // File selection
    selectedAgentFilePath,
    selectedAgentFileContent,
    selectedAgentFileLoading,
    selectAgentFile,
    clearSelectedFile,
    addAgentFileVersion,
    moveAgentFileVersions,
  };
}
