'use client';

import { useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Sparkles, Copy, Check, GitBranch, X, BarChart3,
  PanelRightOpen, Bookmark, BookmarkCheck,
} from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { api } from '@/lib/api';
import { useAppStore, type ChatMessage } from '@/store';
import type { ToolCall, ToolResult, Artifact, StoredMessage, StoredToolCall, ChatSessionDetail } from '@/lib/types';
import {
 ToolBelt, MCPSettingsModal, ChatSettingsModal, extractArtifacts, splitThinking,
} from '@/components/chat';
import { ResearchProgressIndicator, CitationsPanel } from '@/components/chat/research-progress';
import { MessageSearch } from '@/components/chat/message-search';
import type { Attachment } from '@/components/chat';
import { debouncedSave } from '@/lib/chat-state-persistence';
import { useContextManager } from '@/hooks/useContextManager';
import { ContextIndicator } from '@/components/chat/context-indicator';

// Local components, hooks and utils
import { UsageModal, ExportModal, ChatMessageList, ChatSidePanel } from './components';
import { stripThinkingForModelContext, parseSSEEvents, downloadTextFile } from './utils';

// Types
type Message = ChatMessage;


type OpenAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type OpenAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type OpenAIMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string | null | OpenAIContentPart[]; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; name?: string; content: string };

const extractToolResults = (toolCalls: StoredToolCall[] = []): ToolResult[] => {
  return toolCalls
    .filter((tc) => tc.result)
    .map((tc) => {
      const rawResult = tc.result;
      const content = typeof rawResult === 'string'
        ? rawResult
        : rawResult && typeof rawResult === 'object' && 'content' in rawResult
          ? String(rawResult.content ?? '')
          : rawResult != null
            ? JSON.stringify(rawResult)
            : '';
      const isError = rawResult && typeof rawResult === 'object' && 'isError' in rawResult
        ? Boolean((rawResult as { isError?: boolean }).isError)
        : undefined;
      return { tool_call_id: tc.id, content, isError };
    });
};

const normalizeStoredMessage = (message: StoredMessage): Message => {
  const toolCalls = message.tool_calls || [];
  const toolResults = extractToolResults(toolCalls);
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    prompt_tokens: message.prompt_tokens,
    completion_tokens: message.completion_tokens,
    total_tokens: message.total_tokens,
    request_prompt_tokens: message.request_prompt_tokens,
    request_tools_tokens: message.request_tools_tokens,
    request_total_input_tokens: message.request_total_input_tokens,
    request_completion_tokens: message.request_completion_tokens,
    estimated_cost_usd: message.estimated_cost_usd,
  };
};

function ChatPageContent() {
  const {
    currentSessionId,
    currentSessionTitle,
    messages,
    input,
    isLoading,
    error,
    streamingStartTime,
    elapsedSeconds,
    queuedContext,
    runningModel,
    modelName,
    selectedModel,
    availableModels,
    pageLoading,
    copiedIndex,
    isMobile,
    toolPanelOpen,
    activePanel,
    mcpEnabled,
    artifactsEnabled,
    mcpServers,
    mcpSettingsOpen,
    mcpTools,
    executingTools,
    toolResultsMap,
    systemPrompt,
    chatSettingsOpen,
    deepResearch,
    researchProgress,
    researchSources,
    sessionUsage,
    usageDetailsOpen,
    exportOpen,
    messageSearchOpen,
    bookmarkedMessages,
    userScrolledUp,
  } = useAppStore((state) => ({
    currentSessionId: state.currentSessionId,
    currentSessionTitle: state.currentSessionTitle,
    messages: state.messages,
    input: state.input,
    isLoading: state.isLoading,
    error: state.error,
    streamingStartTime: state.streamingStartTime,
    elapsedSeconds: state.elapsedSeconds,
    queuedContext: state.queuedContext,
    runningModel: state.runningModel,
    modelName: state.modelName,
    selectedModel: state.selectedModel,
    availableModels: state.availableModels,
    pageLoading: state.pageLoading,
    copiedIndex: state.copiedIndex,
    isMobile: state.isMobile,
    toolPanelOpen: state.toolPanelOpen,
    activePanel: state.activePanel,
    mcpEnabled: state.mcpEnabled,
    artifactsEnabled: state.artifactsEnabled,
    mcpServers: state.mcpServers,
    mcpSettingsOpen: state.mcpSettingsOpen,
    mcpTools: state.mcpTools,
    executingTools: state.executingTools,
    toolResultsMap: state.toolResultsMap,
    systemPrompt: state.systemPrompt,
    chatSettingsOpen: state.chatSettingsOpen,
    deepResearch: state.deepResearch,
    researchProgress: state.researchProgress,
    researchSources: state.researchSources,
    sessionUsage: state.sessionUsage,
    usageDetailsOpen: state.usageDetailsOpen,
    exportOpen: state.exportOpen,
    messageSearchOpen: state.messageSearchOpen,
    bookmarkedMessages: state.bookmarkedMessages,
    userScrolledUp: state.userScrolledUp,
  }), shallow);

  const {
    setSessions,
    updateSessions,
    setCurrentSessionId,
    setCurrentSessionTitle,
    setSessionsLoading,
    setSessionsAvailable,
    setMessages,
    updateMessages,
    setInput,
    setIsLoading,
    setError,
    setStreamingStartTime,
    setElapsedSeconds,
    setQueuedContext,
    setRunningModel,
    setModelName,
    setSelectedModel,
    setAvailableModels,
    setPageLoading,
    setCopiedIndex,
    setSidebarCollapsed,
    setIsMobile,
    setToolPanelOpen,
    setActivePanel,
    setMcpEnabled,
    setArtifactsEnabled,
    setMcpServers,
    setMcpSettingsOpen,
    setMcpTools,
    updateExecutingTools,
    setToolResultsMap,
    updateToolResultsMap,
    setSystemPrompt,
    setChatSettingsOpen,
    setDeepResearch,
    setResearchProgress,
    setResearchSources,
    setSessionUsage,
    setUsageDetailsOpen,
    setExportOpen,
    setMessageSearchOpen,
    updateBookmarkedMessages,
    setTitleDraft,
    setUserScrolledUp,
  } = useAppStore((state) => ({
    setSessions: state.setSessions,
    updateSessions: state.updateSessions,
    setCurrentSessionId: state.setCurrentSessionId,
    setCurrentSessionTitle: state.setCurrentSessionTitle,
    setSessionsLoading: state.setSessionsLoading,
    setSessionsAvailable: state.setSessionsAvailable,
    setMessages: state.setMessages,
    updateMessages: state.updateMessages,
    setInput: state.setInput,
    setIsLoading: state.setIsLoading,
    setError: state.setError,
    setStreamingStartTime: state.setStreamingStartTime,
    setElapsedSeconds: state.setElapsedSeconds,
    setQueuedContext: state.setQueuedContext,
    setRunningModel: state.setRunningModel,
    setModelName: state.setModelName,
    setSelectedModel: state.setSelectedModel,
    setAvailableModels: state.setAvailableModels,
    setPageLoading: state.setPageLoading,
    setCopiedIndex: state.setCopiedIndex,
    setSidebarCollapsed: state.setSidebarCollapsed,
    setIsMobile: state.setIsMobile,
    setToolPanelOpen: state.setToolPanelOpen,
    setActivePanel: state.setActivePanel,
    setMcpEnabled: state.setMcpEnabled,
    setArtifactsEnabled: state.setArtifactsEnabled,
    setMcpServers: state.setMcpServers,
    setMcpSettingsOpen: state.setMcpSettingsOpen,
    setMcpTools: state.setMcpTools,
    updateExecutingTools: state.updateExecutingTools,
    setToolResultsMap: state.setToolResultsMap,
    updateToolResultsMap: state.updateToolResultsMap,
    setSystemPrompt: state.setSystemPrompt,
    setChatSettingsOpen: state.setChatSettingsOpen,
    setDeepResearch: state.setDeepResearch,
    setResearchProgress: state.setResearchProgress,
    setResearchSources: state.setResearchSources,
    setSessionUsage: state.setSessionUsage,
    setUsageDetailsOpen: state.setUsageDetailsOpen,
    setExportOpen: state.setExportOpen,
    setMessageSearchOpen: state.setMessageSearchOpen,
    updateBookmarkedMessages: state.updateBookmarkedMessages,
    setTitleDraft: state.setTitleDraft,
    setUserScrolledUp: state.setUserScrolledUp,
  }), shallow);

  const usageRefreshTimerRef = useRef<number | null>(null);
  const loadingSessionRef = useRef(false);
  const activeSessionRef = useRef<string | null>(null);
  const searchParams = useSearchParams();
  const sessionFromUrl = searchParams.get('session');
  const newChatFromUrl = searchParams.get('new') === '1';

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Context management
  const maxContext = useMemo(() => {
    const model = availableModels.find(m => m.id === selectedModel || m.id === runningModel);
    return model?.max_model_len || 200000;
  }, [availableModels, selectedModel, runningModel]);

  const contextMessages = useMemo(() => messages.map(m => ({ role: m.role, content: m.content })), [messages]);

  const handleContextCompact = useCallback((newMessages: Array<{ role: string; content: string }>) => {
    const compactedIds = new Set(newMessages.map((m, i) => messages[messages.length - newMessages.length + i]?.id).filter(Boolean));
    updateMessages((prev: Message[]) => prev.filter(m => compactedIds.has(m.id) || prev.indexOf(m) >= prev.length - newMessages.length));
  }, [messages, updateMessages]);

  const contextManager = useContextManager({
    messages: contextMessages, maxContext, systemPrompt,
    tools: mcpEnabled ? mcpTools : undefined, onCompact: handleContextCompact, enabled: true,
  });

  // Computed values
  const allToolCalls = messages.flatMap(m => (m.toolCalls || []).map(tc => ({ ...tc, messageId: m.id, model: m.model })));
  const latestAssistantMessage = useMemo(() => [...messages].reverse().find(m => m.role === 'assistant'), [messages]);
  const thinkingState = useMemo(() => {
    if (!latestAssistantMessage?.content) return { content: null, isComplete: true };
    const { thinkingContent, isThinkingComplete } = splitThinking(latestAssistantMessage.content);
    return { content: thinkingContent, isComplete: isThinkingComplete };
  }, [latestAssistantMessage?.content]);
  const thinkingActive = Boolean(isLoading && thinkingState.content);
  const activityItems = useMemo(() => {
    const items: Array<
      | { type: 'thinking'; id: string; content: string; isComplete: boolean; isStreaming: boolean }
      | { type: 'tool'; id: string; toolCall: ToolCall & { messageId: string; model?: string } }
    > = [];

    const extractThinkingBlocks = (content: string) => {
      const blocks: Array<{ content: string; isComplete: boolean }> = [];
      const openTags = ['<think>', '<thinking>'];
      const closeTags = ['</think>', '</thinking>'];
      let remaining = content;

      while (remaining) {
        const lower = remaining.toLowerCase();
        const openIdxs = openTags
          .map((t) => lower.indexOf(t))
          .filter((i) => i !== -1);
        if (!openIdxs.length) break;
        const openIdx = Math.min(...openIdxs);
        const matchedOpen = openTags.find((t) => lower.startsWith(t, openIdx))!;
        const afterOpen = remaining.slice(openIdx + matchedOpen.length);
        const lowerAfter = afterOpen.toLowerCase();
        const closeIdxs = closeTags
          .map((t) => lowerAfter.indexOf(t))
          .filter((i) => i !== -1);
        if (!closeIdxs.length) {
          const contentBlock = afterOpen.replace(/<\|(?:begin|end)_of_box\|>/g, '').trim();
          if (contentBlock) blocks.push({ content: contentBlock, isComplete: false });
          break;
        }
        const closeIdx = Math.min(...closeIdxs);
        const matchedClose = closeTags.find((t) => lowerAfter.startsWith(t, closeIdx))!;
        const contentBlock = afterOpen.slice(0, closeIdx).replace(/<\|(?:begin|end)_of_box\|>/g, '').trim();
        if (contentBlock) blocks.push({ content: contentBlock, isComplete: true });
        remaining = afterOpen.slice(closeIdx + matchedClose.length);
      }

      return blocks;
    };

    messages.forEach((msg) => {
      if (msg.role !== 'assistant' || !msg.content) return;
      const blocks = extractThinkingBlocks(msg.content);
      const toolCalls = msg.toolCalls || [];
      let toolIndex = 0;

      if (blocks.length === 0 && toolCalls.length === 0) return;

      blocks.forEach((block, idx) => {
        items.push({
          type: 'thinking',
          id: `thinking-${msg.id}-${idx}`,
          content: block.content,
          isComplete: block.isComplete,
          isStreaming: Boolean(msg.isStreaming) && !block.isComplete,
        });
        if (toolIndex < toolCalls.length) {
          const toolCall = toolCalls[toolIndex];
          items.push({
            type: 'tool',
            id: `tool-${msg.id}-${toolCall.id}`,
            toolCall: { ...toolCall, messageId: msg.id, model: msg.model },
          });
          toolIndex += 1;
        }
      });

      while (toolIndex < toolCalls.length) {
        const toolCall = toolCalls[toolIndex];
        items.push({
          type: 'tool',
          id: `tool-${msg.id}-${toolCall.id}`,
          toolCall: { ...toolCall, messageId: msg.id, model: msg.model },
        });
        toolIndex += 1;
      }
    });

    return items;
  }, [messages]);
  const sessionArtifacts = useMemo(() => {
    if (!artifactsEnabled || !messages.length) return [];
    const artifacts: Artifact[] = [];
    messages.forEach(msg => {
      if (msg.role === 'assistant' && msg.content && !msg.isStreaming) {
        const { artifacts: extracted } = extractArtifacts(msg.content);
        extracted.forEach(a => artifacts.push({ ...a, message_id: msg.id, session_id: currentSessionId || undefined }));
      }
    });
    return artifacts;
  }, [artifactsEnabled, currentSessionId, messages]);
  const hasArtifacts = sessionArtifacts.length > 0;
  const hasToolActivity = messages.some(m => m.toolCalls?.length) || executingTools.size > 0 || researchProgress !== null || thinkingActive;
  const hasSidePanelContent = hasToolActivity || hasArtifacts;

  const loadAvailableModels = useCallback(async () => {
    try {
      const res = await api.getOpenAIModels();
      setAvailableModels((res.data || []).map((m) => ({ id: m.id, root: m.root, max_model_len: m.max_model_len })));
    } catch {
      setAvailableModels([]);
    }
  }, [setAvailableModels]);

  const loadMCPServers = useCallback(async () => {
    try {
      const servers = await api.getMCPServers();
      setMcpServers(servers.map((s) => ({ ...s, args: s.args || [], env: s.env || {}, enabled: s.enabled ?? true })));
    } catch {}
  }, [setMcpServers]);

  const loadMCPTools = useCallback(async () => {
    try {
      const response = await api.getMCPTools();
      setMcpTools(response.tools || []);
    } catch {
      setMcpTools([]);
    }
  }, [setMcpTools]);

  const loadStatus = useCallback(async () => {
    try {
      const status = await api.getStatus();
      if (status.process) {
        const modelId = status.process.served_model_name || status.process.model_path || 'default';
        setRunningModel(modelId);
        setModelName(status.process.model_path?.split('/').pop() || 'Model');
        setSelectedModel(selectedModel || modelId);
      }
    } catch {} finally { setPageLoading(false); }
  }, [selectedModel, setRunningModel, setModelName, setSelectedModel, setPageLoading]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getChatSessions();
      setSessions(data.sessions);
      setSessionsAvailable(true);
      if (currentSessionId) {
        const found = data.sessions.find((s) => s.id === currentSessionId);
        if (found?.title) setCurrentSessionTitle(found.title);
      }
    } catch {
      setSessions([]);
      setSessionsAvailable(false);
    } finally {
      setSessionsLoading(false);
    }
  }, [currentSessionId, setCurrentSessionTitle, setSessions, setSessionsAvailable, setSessionsLoading]);

  // Session helpers

  const refreshUsage = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    if (usageRefreshTimerRef.current) window.clearTimeout(usageRefreshTimerRef.current);
    usageRefreshTimerRef.current = window.setTimeout(async () => {
      try {
        const usage = await api.getChatUsage(sessionId);
        setSessionUsage({
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          estimated_cost_usd: usage.estimated_cost_usd ?? null,
        });
      } catch {}
    }, 500);
  }, [setSessionUsage]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (!sessionId || loadingSessionRef.current) return;
    loadingSessionRef.current = true;
    try {
      const { session } = await api.getChatSession(sessionId);
      if (activeSessionRef.current && activeSessionRef.current !== session.id) return;
      setCurrentSessionId(session.id);
      setCurrentSessionTitle(session.title);
      setTitleDraft(session.title);
      if (session.model) setSelectedModel(session.model);
      const msgs: Message[] = (session.messages || []).map(normalizeStoredMessage);
      setMessages(msgs);
      setToolResultsMap(new Map());
      refreshUsage(session.id);
      setSidebarCollapsed(isMobile);
    } catch {
      console.log('Failed to load session');
    } finally {
      loadingSessionRef.current = false;
    }
  }, [isMobile, refreshUsage, setCurrentSessionId, setCurrentSessionTitle, setMessages, setSelectedModel, setSidebarCollapsed, setTitleDraft, setToolResultsMap]);

  // Effects
  useEffect(() => {
    const checkMobile = () => { const mobile = window.innerWidth < 768; setIsMobile(mobile); if (mobile) setSidebarCollapsed(true); };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobile, setSidebarCollapsed]);

  useEffect(() => { debouncedSave({ mcpEnabled, artifactsEnabled, systemPrompt, selectedModel }, 1000); }, [mcpEnabled, artifactsEnabled, systemPrompt, selectedModel]);
  useEffect(() => { loadStatus(); loadSessions(); loadMCPServers(); loadAvailableModels(); }, [loadAvailableModels, loadMCPServers, loadSessions, loadStatus]);

  useEffect(() => {
    if (newChatFromUrl) {
      activeSessionRef.current = null;
      setCurrentSessionId(null);
      setCurrentSessionTitle('New Chat');
      setTitleDraft('New Chat');
      setMessages([]);
      setToolResultsMap(new Map());
      updateExecutingTools(() => new Set());
      setResearchProgress(null);
      setResearchSources([]);
      setSessionUsage(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!sessionFromUrl) return;

    if (activeSessionRef.current !== sessionFromUrl) {
      activeSessionRef.current = sessionFromUrl;
      setMessages([]);
      setToolResultsMap(new Map());
      updateExecutingTools(() => new Set());
      setResearchProgress(null);
      setResearchSources([]);
      setSessionUsage(null);
      setError(null);
      setIsLoading(false);
      loadSession(sessionFromUrl);
    }
  }, [loadSession, newChatFromUrl, sessionFromUrl, setCurrentSessionId, setCurrentSessionTitle, setError, setIsLoading, setMessages, setResearchProgress, setResearchSources, setSessionUsage, setTitleDraft, setToolResultsMap, updateExecutingTools]);

  useEffect(() => { if (!userScrolledUp) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, userScrolledUp]);
  useEffect(() => { if (mcpEnabled) loadMCPTools(); else setMcpTools([]); }, [loadMCPTools, mcpEnabled, setMcpTools]);
  useEffect(() => {
    if (sessionArtifacts.length > 0 && activePanel === 'tools' && !hasToolActivity) {
      setActivePanel('artifacts');
    }
  }, [activePanel, hasToolActivity, sessionArtifacts.length, setActivePanel]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isLoading && streamingStartTime) {
      intervalId = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - streamingStartTime) / 1000)), 1000);
    } else if (!isLoading) {
      const timeoutId = setTimeout(() => { if (!isLoading) { setStreamingStartTime(null); setElapsedSeconds(0); } }, 3000);
      return () => clearTimeout(timeoutId);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isLoading, setElapsedSeconds, setStreamingStartTime, streamingStartTime]);

  const handleScroll = () => { const container = messagesContainerRef.current; if (!container) return; const { scrollTop, scrollHeight, clientHeight } = container; setUserScrolledUp(scrollHeight - scrollTop - clientHeight >= 100); };

  // Build API messages
  const buildAPIMessages = (msgs: Message[]): OpenAIMessage[] => {
    const apiMessages: OpenAIMessage[] = [];
    const sysContent = systemPrompt.trim();
    if (sysContent) apiMessages.push({ role: 'system', content: sysContent });
    if (mcpEnabled && mcpTools.length > 0) { const toolsList = mcpTools.map(t => `- ${t.server}__${t.name}: ${t.description || 'No description'}`).join('\n'); apiMessages.push({ role: 'system', content: `Available tools:\n${toolsList}` }); }
    for (const msg of msgs) {
      if (msg.role === 'user') { const parts: OpenAIContentPart[] = []; if (msg.content) parts.push({ type: 'text', text: msg.content }); if (msg.images?.length) msg.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img}` } })); apiMessages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts }); }
      else { const cleanContent = stripThinkingForModelContext(msg.content); if (msg.toolCalls?.length) { apiMessages.push({ role: 'assistant', content: cleanContent || null, tool_calls: msg.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) }); msg.toolResults?.forEach(tr => apiMessages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })); } else { apiMessages.push({ role: 'assistant', content: cleanContent || '' }); } }
    }
    return apiMessages;
  };

  const getOpenAITools = () => { if (!mcpEnabled || !mcpTools.length) return []; return mcpTools.map(tool => ({ type: 'function', function: { name: `${tool.server}__${tool.name}`, description: tool.description || `Tool ${tool.name} from ${tool.server}`, parameters: tool.inputSchema || { type: 'object', properties: {} } } })); };

  const executeMCPTool = async (toolCall: ToolCall): Promise<ToolResult> => {
    const funcName = toolCall.function?.name || ''; const parts = funcName.split('__'); let server = parts.length > 1 ? parts[0] : ''; let toolName = parts.length > 1 ? parts.slice(1).join('__') : funcName;
    // Fallback: if no server prefix, try to find the tool by name in mcpTools
    if (!server && mcpTools.length > 0) {
      const matchingTool = mcpTools.find(t => t.name === funcName || t.name === toolName);
      if (matchingTool) { server = matchingTool.server; toolName = matchingTool.name; }
    }
    if (!server) { return { tool_call_id: toolCall.id, content: `Error: Could not determine MCP server for tool "${funcName}"`, isError: true }; }
    try { let args: Record<string, unknown> = {}; const rawArgs = (toolCall.function?.arguments || '').trim(); if (rawArgs) { try { args = JSON.parse(rawArgs); } catch { args = { raw: rawArgs }; } } const result = await api.callMCPTool(server, toolName, args); return { tool_call_id: toolCall.id, content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) }; }
    catch (error) { return { tool_call_id: toolCall.id, content: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true }; }
  };

  // Send message
  const sendMessage = async (attachments?: Attachment[]) => {
    const hasText = input.trim().length > 0; const hasAttachments = attachments?.length; const activeModelId = (selectedModel || runningModel || '').trim();
    if ((!hasText && !hasAttachments) || !activeModelId || isLoading || loadingSessionRef.current) return;
    const userContent = input.trim(); const imageAttachments = attachments?.filter(a => a.type === 'image' && a.base64) || [];
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: userContent || (imageAttachments.length ? '[Image]' : '...'), images: imageAttachments.map(a => a.base64!), model: activeModelId };
    updateMessages(prev => [...prev, userMessage]); setInput(''); setIsLoading(true); setStreamingStartTime(Date.now()); setElapsedSeconds(0); setError(null);
    abortControllerRef.current = new AbortController();
    const conversationMessages = buildAPIMessages([...messages, userMessage]);
    let sessionId = currentSessionId || sessionFromUrl || activeSessionRef.current || null;
    if (sessionFromUrl && !currentSessionId) setCurrentSessionId(sessionFromUrl);
    let finalAssistantContent = '';
    const bumpSessionUpdatedAt = () => { if (!sessionId) return; updateSessions(prev => { const existing = prev.find(s => s.id === sessionId); const updated = existing ? { ...existing, updated_at: new Date().toISOString() } : undefined; return updated ? [updated, ...prev.filter(s => s.id !== sessionId)] : prev; }); };

    try {
      if (!sessionId) { try { const { session } = await api.createChatSession({ title: 'New Chat', model: activeModelId || undefined }); sessionId = session.id; setCurrentSessionId(sessionId); updateSessions(prev => [session, ...prev]); setSessionsAvailable(true); } catch {} }
      if (sessionId) { try { const persisted = await api.addChatMessage(sessionId, { id: userMessage.id, role: 'user', content: userContent, model: activeModelId }); const normalized = normalizeStoredMessage(persisted); updateMessages(prev => prev.map(m => m.id === normalized.id ? { ...m, ...normalized } : m)); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }

      let iteration = 0; const MAX_ITERATIONS = 25; const cachedToolResultsBySignature = new Map<string, Omit<ToolResult, 'tool_call_id'>>();
      while (iteration < MAX_ITERATIONS) {
        iteration++;
        const requestBody: Record<string, unknown> = { messages: conversationMessages, model: activeModelId, tools: getOpenAITools() };
        if (activeModelId.toLowerCase().includes('minimax')) { requestBody.temperature = 1.0; requestBody.top_p = 0.95; requestBody.top_k = 40; }
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody), signal: abortControllerRef.current?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const reader = response.body?.getReader(); if (!reader) throw new Error('No response body');
        const assistantMsgId = (Date.now() + iteration).toString();
        updateMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true, model: activeModelId }]);
        let iterationContent = ''; let toolCalls: ToolCall[] = [];
        let pendingContent = ''; let pendingToolCalls: ToolCall[] | null = null; let frameId: number | null = null;
        const flushAssistantUpdate = (force = false) => {
          const applyUpdate = () => {
            frameId = null;
            if (!pendingContent && !pendingToolCalls) return;
            updateMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: pendingContent || iterationContent, toolCalls: pendingToolCalls ?? m.toolCalls } : m));
            pendingContent = '';
            pendingToolCalls = null;
          };
          if (force) { if (frameId !== null) window.cancelAnimationFrame(frameId); applyUpdate(); return; }
          if (frameId === null) frameId = window.requestAnimationFrame(applyUpdate);
        };
        for await (const event of parseSSEEvents(reader)) {
          if (event.type === 'text' && event.content) { iterationContent += event.content; pendingContent = iterationContent; flushAssistantUpdate(); }
          else if (event.type === 'tool_calls' && event.tool_calls) { toolCalls = event.tool_calls as ToolCall[]; pendingToolCalls = toolCalls; flushAssistantUpdate(true); }
          else if (event.type === 'error') { throw new Error(event.error || 'Stream error'); }
        }
        flushAssistantUpdate(true);
        if (!toolCalls.length) {
          finalAssistantContent = iterationContent; updateMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, isStreaming: false } : m));
          if (sessionId) { try { const persisted = await api.addChatMessage(sessionId, { id: assistantMsgId, role: 'assistant', content: iterationContent, model: activeModelId }); const normalized = normalizeStoredMessage(persisted); updateMessages(prev => prev.map(m => m.id === normalized.id ? { ...m, ...normalized } : m)); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }
          break;
        }
        const toolResults: ToolResult[] = []; const toolNameByCallId = new Map<string, string>();
        for (const tc of toolCalls) {
          const signature = `${tc.function?.name}:${tc.function?.arguments}`; toolNameByCallId.set(tc.id, tc.function.name);
          if (cachedToolResultsBySignature.has(signature)) { const cached = cachedToolResultsBySignature.get(signature)!; toolResults.push({ tool_call_id: tc.id, ...cached }); updateToolResultsMap(prev => { const next = new Map(prev); next.set(tc.id, { tool_call_id: tc.id, ...cached }); return next; }); continue; }
          updateExecutingTools(prev => { const next = new Set(prev); next.add(tc.id); return next; }); const result = await executeMCPTool(tc); cachedToolResultsBySignature.set(signature, { content: result.content, isError: result.isError }); toolResults.push(result); updateToolResultsMap(prev => { const next = new Map(prev); next.set(tc.id, result); return next; }); updateExecutingTools(prev => { const next = new Set(prev); next.delete(tc.id); return next; });
        }
        updateMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, toolResults, isStreaming: false } : m));
        if (sessionId) { try { await api.addChatMessage(sessionId, { id: assistantMsgId, role: 'assistant', content: iterationContent, model: activeModelId, tool_calls: toolCalls.map(tc => ({ ...tc, result: toolResults.find(r => r.tool_call_id === tc.id) || null })) }); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }
        const cleanedContent = stripThinkingForModelContext(iterationContent);
        conversationMessages.push({ role: 'assistant', content: cleanedContent || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) });
        toolResults.forEach(r => conversationMessages.push({ role: 'tool', tool_call_id: r.tool_call_id, name: toolNameByCallId.get(r.tool_call_id), content: r.content }));
      }
      const shouldUpdateTitle = currentSessionTitle.trim() === '' || currentSessionTitle === 'New Chat';
      if (sessionId && finalAssistantContent.trim() && (shouldUpdateTitle || !currentSessionId)) {
        const fallbackTitle = userContent.trim().split(/\s+/).slice(0, 6).join(' ');
        try {
          const res = await fetch('/api/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: activeModelId, user: userContent, assistant: finalAssistantContent }) });
          let nextTitle = fallbackTitle;
          if (res.ok) {
            const data = await res.json();
            if (data.title && data.title !== 'New Chat') {
              nextTitle = data.title;
            }
          }
          if (nextTitle) {
            await api.updateChatSession(sessionId, { title: nextTitle });
            updateSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: nextTitle } : s));
            setCurrentSessionTitle(nextTitle);
            setTitleDraft(nextTitle);
          }
        } catch {
          if (fallbackTitle) {
            try {
              await api.updateChatSession(sessionId, { title: fallbackTitle });
              updateSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: fallbackTitle } : s));
              setCurrentSessionTitle(fallbackTitle);
              setTitleDraft(fallbackTitle);
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') { updateMessages(prev => { const last = prev[prev.length - 1]; return last?.role === 'assistant' ? prev.map(m => m.id === last.id ? { ...m, isStreaming: false } : m) : prev; }); }
      else { setError(err instanceof Error ? err.message : 'Failed to send message'); updateMessages(prev => prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.content ? prev.slice(0, -1) : prev); }
    } finally { setIsLoading(false); abortControllerRef.current = null; }
  };

  const stopGeneration = () => abortControllerRef.current?.abort();
  const copyToClipboard = (text: string, index: number) => { navigator.clipboard.writeText(text); setCopiedIndex(index); setTimeout(() => setCopiedIndex(null), 2000); };
  const forkAtMessage = async (messageId: string) => { if (!currentSessionId) return; try { const { session } = await api.forkChatSession(currentSessionId, { message_id: messageId, model: selectedModel || undefined }); updateSessions(prev => [session, ...prev]); await loadSession(session.id); } catch {} };
  const toggleBookmark = (messageId: string) => {
    updateBookmarkedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };
  const copyLastResponse = () => {
    const last = [...messages].reverse().find(m => m.role === 'assistant');
    if (!last) return;
    copyToClipboard(last.content, messages.indexOf(last));
  };

  // Export functions
  const buildChatExport = () => ({ title: currentSessionTitle || 'Chat', session_id: currentSessionId, model: selectedModel || runningModel || null, messages: messages.map(m => ({ id: m.id, role: m.role, model: m.model ?? null, content: m.content, tool_calls: m.toolCalls ?? null, tool_results: m.toolResults ?? null })), session_usage: sessionUsage });
  const exportAsJson = () => { const payload = buildChatExport(); const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80); downloadTextFile(`${name}.json`, JSON.stringify(payload, null, 2), 'application/json'); };
  const exportAsMarkdown = () => { const payload = buildChatExport(); const lines = [`# ${payload.title}`, '']; if (payload.model) lines.push(`- Model: \`${payload.model}\``); lines.push(''); payload.messages.forEach(m => { lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '', m.content || '', ''); }); const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80); downloadTextFile(`${name}.md`, lines.join('\n'), 'text/markdown'); };

  // Render
  if (pageLoading) { return <div className="flex items-center justify-center h-full"><div className="animate-pulse-soft"><Sparkles className="h-8 w-8 text-[#9a9590]" /></div></div>; }

  return (
    <>
      <div className="relative h-full flex overflow-hidden w-full max-w-full">
        <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
          <div className="flex-1 flex overflow-hidden relative">
            {messageSearchOpen && (
              <div className="absolute inset-0 z-50 bg-(--background)/95 backdrop-blur-sm">
                <div className="h-full flex flex-col max-w-2xl mx-auto">
                  <div className="flex items-center justify-between p-4 border-b border-(--border)"><h2 className="text-lg font-semibold">Search Messages</h2><button onClick={() => setMessageSearchOpen(false)} className="p-2 rounded hover:bg-(--accent)"><X className="h-5 w-5" /></button></div>
                  <div className="flex-1 overflow-hidden"><MessageSearch messages={messages} onResultClick={(messageId) => { document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setMessageSearchOpen(false); }} /></div>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="pb-0 md:pb-4">
                  <ChatMessageList messages={messages} selectedModel={selectedModel || runningModel || undefined} modelName={modelName} currentSessionId={currentSessionId} artifactsEnabled={artifactsEnabled} isMobile={isMobile} isLoading={isLoading} error={error} copiedIndex={copiedIndex} toolResultsMap={toolResultsMap} executingTools={executingTools} onCopy={copyToClipboard} onFork={forkAtMessage} />

                  {isMobile && researchProgress && <ResearchProgressIndicator progress={researchProgress} onCancel={() => setResearchProgress(null)} />}
                  {isMobile && researchSources.length > 0 && !researchProgress && <CitationsPanel sources={researchSources} />}

                  {messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !isLoading && (
                    <div className="max-w-4xl mx-auto px-4 md:px-6">
                      <div className="mt-4 pt-3 border-t border-(--border) flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1">
                          <button onClick={copyLastResponse} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-(--accent) text-[#8a8580]">{copiedIndex === messages.length - 1 ? <Check className="h-3.5 w-3.5 text-(--success)" /> : <Copy className="h-3.5 w-3.5" />}<span className="text-xs">Copy</span></button>
                          <button onClick={() => toggleBookmark(messages[messages.length - 1].id)} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-(--accent) text-[#8a8580]">{bookmarkedMessages.has(messages[messages.length - 1].id) ? <BookmarkCheck className="h-3.5 w-3.5 text-(--link)" /> : <Bookmark className="h-3.5 w-3.5" />}<span className="text-xs">Bookmark</span></button>
                          {currentSessionId && <button onClick={() => forkAtMessage(messages[messages.length - 1].id)} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-(--accent) text-[#8a8580]"><GitBranch className="h-3.5 w-3.5" /><span className="text-xs">Fork</span></button>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[#6a6560]">
                          <ContextIndicator stats={contextManager.stats} config={contextManager.config} onCompact={contextManager.compact} onUpdateConfig={contextManager.updateConfig} isWarning={contextManager.isWarning} canSendMessage={contextManager.canSendMessage} utilizationLevel={contextManager.utilizationLevel} />
                          {sessionUsage && (<><span className="text-[#4a4540]">•</span><div className="flex items-center gap-1 cursor-pointer hover:text-[#9a9590]" onClick={() => setUsageDetailsOpen(true)}><BarChart3 className="h-3 w-3" /><span>{sessionUsage.total_tokens.toLocaleString()} total</span>{sessionUsage.estimated_cost_usd != null && <span className="text-[#8a8580]">(${sessionUsage.estimated_cost_usd.toFixed(4)})</span>}</div></>)}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {!isMobile && hasSidePanelContent && !toolPanelOpen && <button onClick={() => setToolPanelOpen(true)} className="absolute right-3 top-3 p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent) z-10" title="Show tools"><PanelRightOpen className="h-4 w-4 text-[#9a9590]" />{(executingTools.size > 0 || thinkingActive) && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-(--success) rounded-full text-[9px] text-white font-medium">{executingTools.size || '•'}</span>}</button>}

              <div className="shrink-0 pb-0 md:pb-3">
                <ToolBelt value={input} onChange={setInput} onSubmit={sendMessage} onStop={stopGeneration} disabled={!((selectedModel || runningModel || '').trim())} isLoading={isLoading} placeholder={(selectedModel || runningModel) ? 'Message...' : 'Select a model in Settings'} mcpEnabled={mcpEnabled} onMcpToggle={() => setMcpEnabled(!mcpEnabled)} artifactsEnabled={artifactsEnabled} onArtifactsToggle={() => setArtifactsEnabled(!artifactsEnabled)} onOpenMcpSettings={() => setMcpSettingsOpen(true)} onOpenChatSettings={() => setChatSettingsOpen(true)} hasSystemPrompt={systemPrompt.trim().length > 0} deepResearchEnabled={deepResearch.enabled} onDeepResearchToggle={() => { const nextEnabled = !deepResearch.enabled; setDeepResearch({ ...deepResearch, enabled: nextEnabled }); if (nextEnabled && !mcpEnabled) setMcpEnabled(true); }} elapsedSeconds={elapsedSeconds} queuedContext={queuedContext} onQueuedContextChange={setQueuedContext} />
              </div>
            </div>

            {!isMobile && hasSidePanelContent && toolPanelOpen && <ChatSidePanel isOpen={toolPanelOpen} onClose={() => setToolPanelOpen(false)} activePanel={activePanel} onSetActivePanel={setActivePanel} allToolCalls={allToolCalls} toolResultsMap={toolResultsMap} executingTools={executingTools} sessionArtifacts={sessionArtifacts} researchProgress={researchProgress} researchSources={researchSources} thinkingContent={thinkingState.content} thinkingActive={thinkingActive} activityItems={activityItems} />}
          </div>
        </div>
      </div>

      <UsageModal isOpen={usageDetailsOpen} onClose={() => setUsageDetailsOpen(false)} sessionUsage={sessionUsage} messages={messages} selectedModel={selectedModel} />
      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} onExportMarkdown={exportAsMarkdown} onExportJson={exportAsJson} />
      <MCPSettingsModal isOpen={mcpSettingsOpen} onClose={() => setMcpSettingsOpen(false)} servers={mcpServers} onServersChange={setMcpServers} />
      <ChatSettingsModal isOpen={chatSettingsOpen} onClose={() => setChatSettingsOpen(false)} systemPrompt={systemPrompt} onSystemPromptChange={setSystemPrompt} availableModels={availableModels} selectedModel={selectedModel} onSelectedModelChange={async (modelId) => { setSelectedModel((modelId || '').trim()); if (currentSessionId) { try { await api.updateChatSession(currentSessionId, { model: modelId || undefined }); updateSessions(p => p.map(s => s.id === currentSessionId ? { ...s, model: modelId } : s)); } catch {} } }} onForkModels={async (modelIds) => { if (!currentSessionId) return; for (const m of modelIds) { try { const { session } = await api.forkChatSession(currentSessionId, { model: m }); updateSessions(p => [session, ...p]); } catch {} } await loadSessions(); }} deepResearch={deepResearch} onDeepResearchChange={s => { setDeepResearch(s); localStorage.setItem('vllm-studio-deep-research', JSON.stringify(s)); if (s.enabled && !mcpEnabled) setMcpEnabled(true); }} />
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-pulse-soft"><Sparkles className="h-8 w-8 text-[#9a9590]" /></div></div>}>
      <ChatPageContent />
    </Suspense>
  );
}
