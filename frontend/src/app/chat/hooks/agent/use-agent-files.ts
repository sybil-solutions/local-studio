// CRITICAL
"use client";

import { useCallback } from "react";
import api from "@/lib/api";
import type { AgentFileEntry } from "@/lib/types";
import { prefetchDependencies as prefetchDependenciesImpl, getExtension } from "./use-agent-files/prefetch-dependencies";
import { resolveAgentFilesSessionId } from "./use-agent-files/resolve-session-id";
import { useAgentFilesStore } from "./use-agent-files/use-agent-files-store";

export function useAgentFiles() {
  const {
    currentSessionId,
    agentFiles,
    agentFilesLoading,
    setAgentFiles,
    setAgentFilesLoading,
    selectedAgentFilePath,
    selectedAgentFileContent,
    selectedAgentFileLoading,
    setSelectedAgentFilePath,
    setSelectedAgentFileContent,
    setSelectedAgentFileLoading,
    agentFileVersions,
    addAgentFileVersion,
    hydrateAgentFileVersions,
    moveAgentFileVersions,
    clearAgentFileVersions,
  } = useAgentFilesStore();

  const prefetchDependencies = useCallback(
    async (entryPath: string, content: string, sessionId: string) => {
      return prefetchDependenciesImpl({
        entryPath,
        content,
        sessionId,
        addAgentFileVersion,
      });
    },
    [addAgentFileVersion],
  );

  const resolveSessionId = (sessionIdOverride?: string | null) => {
    return resolveAgentFilesSessionId({ currentSessionId, sessionIdOverride });
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
    if (agentFiles.length === 0) {
      if (!agentFilesLoading && selectedAgentFilePath === null && selectedAgentFileContent === null) {
        if (Object.keys(agentFileVersions).length === 0) {
          return;
        }
      }
    } else {
      setAgentFiles([]);
    }

    if (agentFilesLoading) {
      setAgentFilesLoading(false);
    }
    if (selectedAgentFilePath !== null) {
      setSelectedAgentFilePath(null);
    }
    if (selectedAgentFileContent !== null) {
      setSelectedAgentFileContent(null);
    }
    if (Object.keys(agentFileVersions).length > 0) {
      clearAgentFileVersions();
    }
  }, [
    agentFiles.length,
    agentFilesLoading,
    agentFileVersions,
    selectedAgentFilePath,
    selectedAgentFileContent,
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
        const data = await api.readAgentFileWithVersions(sessionId, path);
        setSelectedAgentFileContent(data.content);
        if (typeof data.content === "string") {
          if (Array.isArray(data.versions) && data.versions.length > 0) {
            hydrateAgentFileVersions(path, data.versions);
          } else {
            addAgentFileVersion(path, data.content);
          }
          const ext = getExtension(path);
          if (ext === "html" || ext === "htm") {
            void prefetchDependencies(path, data.content, sessionId);
          }
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
      hydrateAgentFileVersions,
      prefetchDependencies,
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
