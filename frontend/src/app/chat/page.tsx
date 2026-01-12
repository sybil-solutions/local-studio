'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Sparkles, Copy, Check, Plus, GitBranch, X, BarChart3,
  PanelRightOpen, Bookmark, BookmarkCheck,
} from 'lucide-react';
import Link from 'next/link';
import { api, RAGClient } from '@/lib/api';
import type { ChatSession, ToolCall, ToolResult, Artifact, RAGDocument } from '@/lib/types';
import {
  MessageRenderer, ChatSidebar, ToolBelt, MCPSettingsModal, ChatSettingsModal, extractArtifacts, ArtifactPanel,
} from '@/components/chat';
import { ResearchProgressIndicator, CitationsPanel } from '@/components/chat/research-progress';
import { MessageSearch } from '@/components/chat/message-search';
import type { Attachment, MCPServerConfig, DeepResearchSettings, RAGSettings } from '@/components/chat';
import type { ResearchProgress, ResearchSource } from '@/components/chat/research-progress';
import { loadState, saveState, debouncedSave } from '@/lib/chat-state-persistence';
import { useContextManager } from '@/hooks/useContextManager';
import { ContextIndicator } from '@/components/chat/context-indicator';
import type { CompactionEvent } from '@/lib/context-manager';

// Local components, hooks and utils
import { ChatMobileHeader, UsageModal, ExportModal, ChatMessageList, ChatSidePanel } from './components';
import { stripThinkingForModelContext, parseSSEEvents, downloadTextFile } from './utils';
import type { StreamEvent } from './utils';

// Types
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  model?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  request_prompt_tokens?: number | null;
  request_tools_tokens?: number | null;
  request_total_input_tokens?: number | null;
  request_completion_tokens?: number | null;
  estimated_cost_usd?: number | null;
}

interface MCPTool {
  server: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

type OpenAIContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type OpenAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type OpenAIMessage =
  | { role: 'user' | 'assistant' | 'system'; content: string | null | OpenAIContentPart[]; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; name?: string; content: string };

export default function ChatPage() {
  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState('New Chat');
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsAvailable, setSessionsAvailable] = useState(true);

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Timer state
  const [streamingStartTime, setStreamingStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [queuedContext, setQueuedContext] = useState('');

  // Model state
  const [runningModel, setRunningModel] = useState<string | null>(null);
  const [modelName, setModelName] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; root?: string; max_model_len?: number }>>([]);
  const [pageLoading, setPageLoading] = useState(true);

  // UI state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [toolPanelOpen, setToolPanelOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<'tools' | 'artifacts'>('tools');
  const [sessionArtifacts, setSessionArtifacts] = useState<Artifact[]>([]);

  // MCP state
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [executingTools, setExecutingTools] = useState<Set<string>>(new Set());
  const [toolResultsMap, setToolResultsMap] = useState<Map<string, ToolResult>>(new Map());

  // Chat settings
  const [systemPrompt, setSystemPrompt] = useState('');
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);

  // Deep Research
  const [deepResearch, setDeepResearch] = useState<DeepResearchSettings>({
    enabled: false, numSources: 5, autoSummarize: true, includeCitations: true, searchDepth: 'normal',
  });
  const [researchProgress, setResearchProgress] = useState<ResearchProgress | null>(null);
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);

  // RAG state
  const [ragSettings, setRagSettings] = useState<RAGSettings>({
    enabled: false, endpoint: 'http://localhost:3002', topK: 5, minScore: 0.0,
    includeMetadata: true, contextPosition: 'system', useProxy: true,
  });
  const [ragStatus, setRagStatus] = useState<'online' | 'offline' | 'checking'>('offline');
  const [ragContext, setRagContext] = useState<RAGDocument[]>([]);
  const ragClientRef = useRef<RAGClient | null>(null);

  // Usage state
  const [sessionUsage, setSessionUsage] = useState<{ prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd?: number | null } | null>(null);
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const usageRefreshTimerRef = useRef<number | null>(null);

  // Other UI state
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [bookmarkedMessages, setBookmarkedMessages] = useState<Set<string>>(new Set());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Context management
  const maxContext = useMemo(() => {
    const model = availableModels.find(m => m.id === selectedModel || m.id === runningModel);
    return model?.max_model_len || 200000;
  }, [availableModels, selectedModel, runningModel]);

  const contextMessages = useMemo(() => messages.map(m => ({ role: m.role, content: m.content })), [messages]);

  const handleContextCompact = useCallback((newMessages: Array<{ role: string; content: string }>, event: CompactionEvent) => {
    const compactedIds = new Set(newMessages.map((m, i) => messages[messages.length - newMessages.length + i]?.id).filter(Boolean));
    setMessages(prev => prev.filter(m => compactedIds.has(m.id) || prev.indexOf(m) >= prev.length - newMessages.length));
  }, [messages]);

  const contextManager = useContextManager({
    messages: contextMessages, maxContext, systemPrompt,
    tools: mcpEnabled ? mcpTools : undefined, onCompact: handleContextCompact, enabled: true,
  });

  // Computed values
  const hasToolActivity = messages.some(m => m.toolCalls?.length) || executingTools.size > 0 || researchProgress !== null;
  const hasArtifacts = sessionArtifacts.length > 0;
  const hasSidePanelContent = hasToolActivity || hasArtifacts;
  const allToolCalls = messages.flatMap(m => (m.toolCalls || []).map(tc => ({ ...tc, messageId: m.id, model: m.model })));

  // Effects
  useEffect(() => {
    const checkMobile = () => { const mobile = window.innerWidth < 768; setIsMobile(mobile); if (mobile) setSidebarCollapsed(true); };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const restored = loadState();
    if (restored.input) setInput(restored.input);
    if (restored.mcpEnabled) setMcpEnabled(restored.mcpEnabled);
    if (restored.artifactsEnabled) setArtifactsEnabled(restored.artifactsEnabled);
    if (restored.systemPrompt) setSystemPrompt(restored.systemPrompt);
    if (restored.selectedModel) setSelectedModel(restored.selectedModel);
    try {
      const dr = localStorage.getItem('vllm-studio-deep-research');
      if (dr) setDeepResearch(JSON.parse(dr));
      const rag = localStorage.getItem('vllm-studio-rag-settings');
      if (rag) setRagSettings(JSON.parse(rag));
    } catch {}
  }, []);

  useEffect(() => { debouncedSave({ mcpEnabled, artifactsEnabled, systemPrompt, selectedModel }, 1000); }, [mcpEnabled, artifactsEnabled, systemPrompt, selectedModel]);
  useEffect(() => { loadStatus(); loadSessions(); loadMCPServers(); loadAvailableModels(); }, []);
  useEffect(() => { if (ragSettings.endpoint) ragClientRef.current = new RAGClient(ragSettings.endpoint, ragSettings.apiKey, ragSettings.useProxy); }, [ragSettings.endpoint, ragSettings.apiKey, ragSettings.useProxy]);

  useEffect(() => {
    if (!ragSettings.enabled) { setRagStatus('offline'); return; }
    const check = async () => {
      setRagStatus('checking');
      try {
        if (!ragClientRef.current) ragClientRef.current = new RAGClient(ragSettings.endpoint, ragSettings.apiKey, ragSettings.useProxy);
        const health = await ragClientRef.current.health();
        setRagStatus(health.status === 'ok' || health.status === 'healthy' ? 'online' : 'offline');
      } catch { setRagStatus('offline'); }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [ragSettings.enabled, ragSettings.endpoint, ragSettings.apiKey, ragSettings.useProxy]);

  useEffect(() => { if (!userScrolledUp) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, userScrolledUp]);
  useEffect(() => { if (mcpEnabled) loadMCPTools(); else setMcpTools([]); }, [mcpEnabled]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isLoading && streamingStartTime) {
      intervalId = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - streamingStartTime) / 1000)), 1000);
    } else if (!isLoading) {
      const timeoutId = setTimeout(() => { if (!isLoading) { setStreamingStartTime(null); setElapsedSeconds(0); } }, 3000);
      return () => clearTimeout(timeoutId);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isLoading, streamingStartTime]);

  useEffect(() => {
    if (!artifactsEnabled || !messages.length) { setSessionArtifacts([]); return; }
    const artifacts: Artifact[] = [];
    messages.forEach(msg => {
      if (msg.role === 'assistant' && msg.content) {
        const { artifacts: extracted } = extractArtifacts(msg.content);
        extracted.forEach(a => artifacts.push({ ...a, message_id: msg.id, session_id: currentSessionId || undefined }));
      }
    });
    setSessionArtifacts(artifacts);
    if (artifacts.length > 0 && sessionArtifacts.length === 0) setActivePanel('artifacts');
  }, [messages, artifactsEnabled, currentSessionId]);

  // Load functions
  const loadAvailableModels = async () => { try { const res = await api.getOpenAIModels(); setAvailableModels((res.data || []).map((m: any) => ({ id: m.id, root: m.root, max_model_len: m.max_model_len }))); } catch { setAvailableModels([]); } };
  const loadMCPServers = async () => { try { const servers = await api.getMCPServers(); setMcpServers(servers.map((s: any) => ({ ...s, args: s.args || [], env: s.env || {}, enabled: s.enabled ?? true }))); } catch {} };
  const loadMCPTools = async () => { try { const response = await api.getMCPTools(); setMcpTools(response.tools || []); } catch { setMcpTools([]); } };

  const loadStatus = async () => {
    try {
      const status = await api.getStatus();
      if (status.process) {
        const modelId = status.process.served_model_name || status.process.model_path || 'default';
        setRunningModel(modelId); setModelName(status.process.model_path?.split('/').pop() || 'Model'); setSelectedModel(prev => prev || modelId);
      }
    } catch {} finally { setPageLoading(false); }
  };

  const loadSessions = async () => {
    try { const data = await api.getChatSessions(); setSessions(data.sessions); setSessionsAvailable(true); if (currentSessionId) { const found = data.sessions.find((s: any) => s.id === currentSessionId); if (found?.title) setCurrentSessionTitle(found.title); } } catch { setSessions([]); setSessionsAvailable(false); } finally { setSessionsLoading(false); }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const { session } = await api.getChatSession(sessionId);
      setCurrentSessionId(session.id); setCurrentSessionTitle(session.title); setTitleDraft(session.title);
      if (session.model) setSelectedModel(session.model);
      const msgs: Message[] = (session.messages || []).map((m: any) => {
        const toolCalls = m.tool_calls || [];
        // Extract tool results from embedded tc.result (how they're stored in DB)
        const toolResults = toolCalls
          .filter((tc: any) => tc.result)
          .map((tc: any) => ({ tool_call_id: tc.id, content: tc.result.content || tc.result, isError: tc.result.isError }));
        return {
          id: m.id, role: m.role, content: m.content, model: m.model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          prompt_tokens: m.prompt_tokens, completion_tokens: m.completion_tokens, total_tokens: m.total_tokens,
          request_prompt_tokens: m.request_prompt_tokens, request_tools_tokens: m.request_tools_tokens,
          request_total_input_tokens: m.request_total_input_tokens, request_completion_tokens: m.request_completion_tokens,
          estimated_cost_usd: m.estimated_cost_usd,
        };
      });
      setMessages(msgs); setToolResultsMap(new Map()); refreshUsage(session.id); setSidebarCollapsed(isMobile);
    } catch { console.log('Failed to load session'); }
  };

  const createSession = () => { setCurrentSessionId(null); setCurrentSessionTitle('New Chat'); setTitleDraft(''); setMessages([]); setToolResultsMap(new Map()); setSessionUsage(null); setRagContext([]); setResearchSources([]); setSidebarCollapsed(isMobile); };
  const deleteSession = async (sessionId: string) => { try { await api.deleteChatSession(sessionId); setSessions(prev => prev.filter(s => s.id !== sessionId)); if (currentSessionId === sessionId) createSession(); } catch {} };

  const refreshUsage = async (sessionId: string) => {
    if (!sessionId) return;
    if (usageRefreshTimerRef.current) window.clearTimeout(usageRefreshTimerRef.current);
    usageRefreshTimerRef.current = window.setTimeout(async () => { try { const usage = await api.getChatUsage(sessionId); setSessionUsage({ prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, estimated_cost_usd: usage.estimated_cost_usd ?? null }); } catch {} }, 500);
  };

  const handleScroll = () => { const container = messagesContainerRef.current; if (!container) return; const { scrollTop, scrollHeight, clientHeight } = container; setUserScrolledUp(scrollHeight - scrollTop - clientHeight >= 100); };

  // Build API messages
  const buildAPIMessages = (msgs: Message[], ragDocs: RAGDocument[] = []): OpenAIMessage[] => {
    const apiMessages: OpenAIMessage[] = [];
    let sysContent = systemPrompt.trim();
    if (ragDocs.length > 0 && ragSettings.contextPosition === 'system') { const ragText = ragDocs.map(d => d.content).join('\n\n---\n\n'); sysContent = sysContent ? `${sysContent}\n\n## Retrieved Context:\n${ragText}` : `## Retrieved Context:\n${ragText}`; }
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
    const funcName = toolCall.function?.name || ''; const parts = funcName.split('__'); const server = parts.length > 1 ? parts[0] : ''; const toolName = parts.length > 1 ? parts.slice(1).join('__') : funcName;
    try { let args: Record<string, unknown> = {}; const rawArgs = (toolCall.function?.arguments || '').trim(); if (rawArgs) { try { args = JSON.parse(rawArgs); } catch { args = { raw: rawArgs }; } } const result = await api.callMCPTool(server, toolName, args); return { tool_call_id: toolCall.id, content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result) }; }
    catch (error) { return { tool_call_id: toolCall.id, content: `Error: ${error instanceof Error ? error.message : String(error)}`, isError: true }; }
  };

  const queryRAG = async (text: string): Promise<RAGDocument[]> => {
    if (!ragSettings.enabled || ragStatus !== 'online' || !ragClientRef.current) return [];
    try {
      const result = await ragClientRef.current.query(text, { topK: ragSettings.topK });
      return (result.documents || []).map(d => ({ id: d.id, content: d.content, score: d.score, metadata: d.metadata, source: d.source }));
    } catch { return []; }
  };

  // Send message
  const sendMessage = async (attachments?: Attachment[]) => {
    const hasText = input.trim().length > 0; const hasAttachments = attachments?.length; const activeModelId = (selectedModel || runningModel || '').trim();
    if ((!hasText && !hasAttachments) || !activeModelId || isLoading) return;
    const userContent = input.trim(); const imageAttachments = attachments?.filter(a => a.type === 'image' && a.base64) || [];
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: userContent || (imageAttachments.length ? '[Image]' : '...'), images: imageAttachments.map(a => a.base64!), model: activeModelId };
    setMessages(prev => [...prev, userMessage]); setInput(''); setIsLoading(true); setStreamingStartTime(Date.now()); setElapsedSeconds(0); setError(null);
    abortControllerRef.current = new AbortController();
    let ragDocs: RAGDocument[] = []; if (ragSettings.enabled && ragStatus === 'online') { try { ragDocs = await queryRAG(userContent); setRagContext(ragDocs); } catch {} }
    let conversationMessages = buildAPIMessages([...messages, userMessage], ragDocs); let sessionId = currentSessionId; let finalAssistantContent = '';
    const bumpSessionUpdatedAt = () => { if (!sessionId) return; setSessions(prev => { const existing = prev.find(s => s.id === sessionId); const updated = existing ? { ...existing, updated_at: new Date().toISOString() } : undefined; return updated ? [updated, ...prev.filter(s => s.id !== sessionId)] : prev; }); };

    try {
      if (!sessionId) { try { const { session } = await api.createChatSession({ title: 'New Chat', model: activeModelId || undefined }); sessionId = session.id; setCurrentSessionId(sessionId); setSessions(prev => [session, ...prev]); setSessionsAvailable(true); } catch {} }
      if (sessionId) { try { const persisted = await api.addChatMessage(sessionId, { id: userMessage.id, role: 'user', content: userContent, model: activeModelId }); setMessages(prev => prev.map(m => m.id === persisted.id ? { ...m, ...persisted } : m)); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }

      let iteration = 0; const MAX_ITERATIONS = 25; const cachedToolResultsBySignature = new Map<string, Omit<ToolResult, 'tool_call_id'>>();
      while (iteration < MAX_ITERATIONS) {
        iteration++;
        const requestBody: Record<string, unknown> = { messages: conversationMessages, model: activeModelId, tools: getOpenAITools() };
        if (activeModelId.toLowerCase().includes('minimax')) { requestBody.temperature = 1.0; requestBody.top_p = 0.95; requestBody.top_k = 40; }
        const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody), signal: abortControllerRef.current?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const reader = response.body?.getReader(); if (!reader) throw new Error('No response body');
        const assistantMsgId = (Date.now() + iteration).toString();
        setMessages(prev => [...prev, { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true, model: activeModelId }]);
        let iterationContent = ''; let toolCalls: ToolCall[] = [];
        for await (const event of parseSSEEvents(reader)) {
          if (event.type === 'text' && event.content) { iterationContent += event.content; setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: iterationContent } : m)); }
          else if (event.type === 'tool_calls' && event.tool_calls) { toolCalls = event.tool_calls as ToolCall[]; setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, toolCalls } : m)); }
          else if (event.type === 'error') { throw new Error(event.error || 'Stream error'); }
        }
        if (!toolCalls.length) {
          finalAssistantContent = iterationContent; setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, isStreaming: false } : m));
          if (sessionId) { try { const persisted = await api.addChatMessage(sessionId, { id: assistantMsgId, role: 'assistant', content: iterationContent, model: activeModelId }); setMessages(prev => prev.map(m => m.id === persisted.id ? { ...m, ...persisted } : m)); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }
          break;
        }
        const toolResults: ToolResult[] = []; const toolNameByCallId = new Map<string, string>();
        for (const tc of toolCalls) {
          const signature = `${tc.function?.name}:${tc.function?.arguments}`; toolNameByCallId.set(tc.id, tc.function.name);
          if (cachedToolResultsBySignature.has(signature)) { const cached = cachedToolResultsBySignature.get(signature)!; toolResults.push({ tool_call_id: tc.id, ...cached }); setToolResultsMap(prev => new Map(prev).set(tc.id, { tool_call_id: tc.id, ...cached })); continue; }
          setExecutingTools(prev => new Set(prev).add(tc.id)); const result = await executeMCPTool(tc); cachedToolResultsBySignature.set(signature, { content: result.content, isError: result.isError }); toolResults.push(result); setToolResultsMap(prev => new Map(prev).set(tc.id, result)); setExecutingTools(prev => { const next = new Set(prev); next.delete(tc.id); return next; });
        }
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, toolResults, isStreaming: false } : m));
        if (sessionId) { try { await api.addChatMessage(sessionId, { id: assistantMsgId, role: 'assistant', content: iterationContent, model: activeModelId, tool_calls: toolCalls.map(tc => ({ ...tc, result: toolResults.find(r => r.tool_call_id === tc.id) || null })) }); bumpSessionUpdatedAt(); refreshUsage(sessionId); } catch {} }
        const cleanedContent = stripThinkingForModelContext(iterationContent);
        conversationMessages.push({ role: 'assistant', content: cleanedContent || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments } })) });
        toolResults.forEach(r => conversationMessages.push({ role: 'tool', tool_call_id: r.tool_call_id, name: toolNameByCallId.get(r.tool_call_id), content: r.content }));
      }
      if (!currentSessionId && sessionId && finalAssistantContent.trim()) { try { const res = await fetch('/api/title', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: activeModelId, user: userContent, assistant: finalAssistantContent }) }); if (res.ok) { const data = await res.json(); if (data.title) { await api.updateChatSession(sessionId, { title: data.title }); setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: data.title } : s)); setCurrentSessionTitle(data.title); setTitleDraft(data.title); } } } catch {} }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') { setMessages(prev => { const last = prev[prev.length - 1]; return last?.role === 'assistant' ? prev.map(m => m.id === last.id ? { ...m, isStreaming: false } : m) : prev; }); }
      else { setError(err instanceof Error ? err.message : 'Failed to send message'); setMessages(prev => prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.content ? prev.slice(0, -1) : prev); }
    } finally { setIsLoading(false); abortControllerRef.current = null; }
  };

  const stopGeneration = () => abortControllerRef.current?.abort();
  const copyToClipboard = (text: string, index: number) => { navigator.clipboard.writeText(text); setCopiedIndex(index); setTimeout(() => setCopiedIndex(null), 2000); };
  const forkAtMessage = async (messageId: string) => { if (!currentSessionId) return; try { const { session } = await api.forkChatSession(currentSessionId, { message_id: messageId, model: selectedModel || undefined }); setSessions(prev => [session, ...prev]); await loadSession(session.id); } catch {} };
  const toggleBookmark = (messageId: string) => { setBookmarkedMessages(prev => { const next = new Set(prev); next.has(messageId) ? next.delete(messageId) : next.add(messageId); return next; }); };
  const copyLastResponse = () => { const last = [...messages].reverse().find(m => m.role === 'assistant'); if (last) copyToClipboard(last.content, messages.indexOf(last)); };

  // Export functions
  const buildChatExport = () => ({ title: currentSessionTitle || 'Chat', session_id: currentSessionId, model: selectedModel || runningModel || null, messages: messages.map(m => ({ id: m.id, role: m.role, model: m.model ?? null, content: m.content, tool_calls: m.toolCalls ?? null, tool_results: m.toolResults ?? null })), session_usage: sessionUsage });
  const exportAsJson = () => { const payload = buildChatExport(); const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80); downloadTextFile(`${name}.json`, JSON.stringify(payload, null, 2), 'application/json'); };
  const exportAsMarkdown = () => { const payload = buildChatExport(); const lines = [`# ${payload.title}`, '']; if (payload.model) lines.push(`- Model: \`${payload.model}\``); lines.push(''); payload.messages.forEach(m => { lines.push(`## ${m.role === 'user' ? 'User' : 'Assistant'}`, '', m.content || '', ''); }); const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80); downloadTextFile(`${name}.md`, lines.join('\n'), 'text/markdown'); };

  // Render
  if (pageLoading) { return <div className="flex items-center justify-center h-[100dvh]"><div className="animate-pulse-soft"><Sparkles className="h-8 w-8 text-[#9a9590]" /></div></div>; }

  return (
    <>
      <div className="relative h-[100dvh] flex flex-col overflow-hidden w-full max-w-full">
        {!isMobile && <ChatSidebar sessions={sessions} currentSessionId={currentSessionId} onSelectSession={loadSession} onNewSession={createSession} onDeleteSession={deleteSession} isCollapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} isLoading={sessionsLoading} isMobile={false} />}
        {isMobile && !sidebarCollapsed && <ChatSidebar sessions={sessions} currentSessionId={currentSessionId} onSelectSession={loadSession} onNewSession={createSession} onDeleteSession={deleteSession} isCollapsed={false} onToggleCollapse={() => setSidebarCollapsed(true)} isLoading={sessionsLoading} isMobile={true} />}

        <div className={`flex-1 flex flex-col min-h-0 overflow-x-hidden ${isMobile ? '' : sidebarCollapsed ? 'md:ml-12' : 'md:ml-60'}`}>
          {isMobile && <ChatMobileHeader currentSessionTitle={currentSessionTitle} currentSessionId={currentSessionId} sessions={sessions} onSelectSession={loadSession} onNewSession={createSession} onOpenSidebar={() => setSidebarCollapsed(false)} />}

          <div className="flex-1 flex overflow-hidden relative">
            {messageSearchOpen && (
              <div className="absolute inset-0 z-50 bg-[var(--background)]/95 backdrop-blur-sm">
                <div className="h-full flex flex-col max-w-2xl mx-auto">
                  <div className="flex items-center justify-between p-4 border-b border-[var(--border)]"><h2 className="text-lg font-semibold">Search Messages</h2><button onClick={() => setMessageSearchOpen(false)} className="p-2 rounded hover:bg-[var(--accent)]"><X className="h-5 w-5" /></button></div>
                  <div className="flex-1 overflow-hidden"><MessageSearch messages={messages} onResultClick={(messageId) => { document.getElementById(`message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); setMessageSearchOpen(false); }} /></div>
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div ref={messagesContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden">
                <div className="pb-4">
                  <ChatMessageList messages={messages} selectedModel={selectedModel || runningModel || undefined} modelName={modelName} currentSessionId={currentSessionId} artifactsEnabled={artifactsEnabled} isMobile={isMobile} isLoading={isLoading} error={error} copiedIndex={copiedIndex} toolResultsMap={toolResultsMap} executingTools={executingTools} onCopy={copyToClipboard} onFork={forkAtMessage} />

                  {isMobile && researchProgress && <ResearchProgressIndicator progress={researchProgress} onCancel={() => setResearchProgress(null)} />}
                  {isMobile && researchSources.length > 0 && !researchProgress && <CitationsPanel sources={researchSources} />}

                  {messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !isLoading && (
                    <div className="max-w-4xl mx-auto px-4 md:px-6">
                      <div className="mt-4 pt-3 border-t border-[var(--border)] flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1">
                          <button onClick={copyLastResponse} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--accent)] text-[#8a8580]">{copiedIndex === messages.length - 1 ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}<span className="text-xs">Copy</span></button>
                          <button onClick={() => toggleBookmark(messages[messages.length - 1].id)} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--accent)] text-[#8a8580]">{bookmarkedMessages.has(messages[messages.length - 1].id) ? <BookmarkCheck className="h-3.5 w-3.5 text-[var(--link)]" /> : <Bookmark className="h-3.5 w-3.5" />}<span className="text-xs">Bookmark</span></button>
                          {currentSessionId && <button onClick={() => forkAtMessage(messages[messages.length - 1].id)} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--accent)] text-[#8a8580]"><GitBranch className="h-3.5 w-3.5" /><span className="text-xs">Fork</span></button>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[#6a6560]">
                          <ContextIndicator stats={contextManager.stats} config={contextManager.config} onCompact={contextManager.compact} onUpdateConfig={contextManager.updateConfig} isWarning={contextManager.isWarning} isCritical={contextManager.isCritical} canSendMessage={contextManager.canSendMessage} utilizationLevel={contextManager.utilizationLevel} />
                          {sessionUsage && (<><span className="text-[#4a4540]">•</span><div className="flex items-center gap-1 cursor-pointer hover:text-[#9a9590]" onClick={() => setUsageDetailsOpen(true)}><BarChart3 className="h-3 w-3" /><span>{sessionUsage.total_tokens.toLocaleString()} total</span>{sessionUsage.estimated_cost_usd != null && <span className="text-[#8a8580]">(${sessionUsage.estimated_cost_usd.toFixed(4)})</span>}</div></>)}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {!isMobile && hasSidePanelContent && !toolPanelOpen && <button onClick={() => setToolPanelOpen(true)} className="absolute right-3 top-3 p-1.5 bg-[var(--card)] border border-[var(--border)] rounded hover:bg-[var(--accent)] z-10" title="Show tools"><PanelRightOpen className="h-4 w-4 text-[#9a9590]" />{executingTools.size > 0 && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-[var(--success)] rounded-full text-[9px] text-white font-medium">{executingTools.size}</span>}</button>}

              <div className="flex-shrink-0 pb-0 md:pb-3">
                <ToolBelt value={input} onChange={setInput} onSubmit={sendMessage} onStop={stopGeneration} disabled={!((selectedModel || runningModel || '').trim())} isLoading={isLoading} modelName={selectedModel || modelName} placeholder={(selectedModel || runningModel) ? 'Message...' : 'Select a model in Settings'} mcpEnabled={mcpEnabled} onMcpToggle={() => setMcpEnabled(!mcpEnabled)} mcpServers={mcpServers.map(s => ({ name: s.name, enabled: s.enabled }))} artifactsEnabled={artifactsEnabled} onArtifactsToggle={() => setArtifactsEnabled(!artifactsEnabled)} onOpenMcpSettings={() => setMcpSettingsOpen(true)} onOpenChatSettings={() => setChatSettingsOpen(true)} hasSystemPrompt={systemPrompt.trim().length > 0} deepResearchEnabled={deepResearch.enabled} onDeepResearchToggle={() => { setDeepResearch(p => ({ ...p, enabled: !p.enabled })); if (!deepResearch.enabled && !mcpEnabled) setMcpEnabled(true); }} ragEnabled={ragSettings.enabled} onRagToggle={() => { setRagSettings(p => ({ ...p, enabled: !p.enabled })); localStorage.setItem('vllm-studio-rag-settings', JSON.stringify({ ...ragSettings, enabled: !ragSettings.enabled })); }} ragStatus={ragStatus} elapsedSeconds={elapsedSeconds} queuedContext={queuedContext} onQueuedContextChange={setQueuedContext} />
              </div>
            </div>

            {!isMobile && hasSidePanelContent && toolPanelOpen && <ChatSidePanel isOpen={toolPanelOpen} onClose={() => setToolPanelOpen(false)} activePanel={activePanel} onSetActivePanel={setActivePanel} allToolCalls={allToolCalls} toolResultsMap={toolResultsMap} executingTools={executingTools} sessionArtifacts={sessionArtifacts} researchProgress={researchProgress} researchSources={researchSources} />}
          </div>
        </div>
      </div>

      <UsageModal isOpen={usageDetailsOpen} onClose={() => setUsageDetailsOpen(false)} sessionUsage={sessionUsage} messages={messages} selectedModel={selectedModel} />
      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} onExportMarkdown={exportAsMarkdown} onExportJson={exportAsJson} />
      <MCPSettingsModal isOpen={mcpSettingsOpen} onClose={() => setMcpSettingsOpen(false)} servers={mcpServers} onServersChange={setMcpServers} />
      <ChatSettingsModal isOpen={chatSettingsOpen} onClose={() => setChatSettingsOpen(false)} systemPrompt={systemPrompt} onSystemPromptChange={setSystemPrompt} availableModels={availableModels} selectedModel={selectedModel} onSelectedModelChange={async (modelId) => { setSelectedModel((modelId || '').trim()); if (currentSessionId) { try { await api.updateChatSession(currentSessionId, { model: modelId || undefined }); setSessions(p => p.map(s => s.id === currentSessionId ? { ...s, model: modelId } : s)); } catch {} } }} onForkModels={async (modelIds) => { if (!currentSessionId) return; for (const m of modelIds) { try { const { session } = await api.forkChatSession(currentSessionId, { model: m }); setSessions(p => [session, ...p]); } catch {} } await loadSessions(); }} deepResearch={deepResearch} onDeepResearchChange={s => { setDeepResearch(s); localStorage.setItem('vllm-studio-deep-research', JSON.stringify(s)); if (s.enabled && !mcpEnabled) setMcpEnabled(true); }} ragSettings={ragSettings} onRagSettingsChange={s => { setRagSettings(s); localStorage.setItem('vllm-studio-rag-settings', JSON.stringify(s)); }} onTestRagConnection={async () => { if (!ragClientRef.current) ragClientRef.current = new RAGClient(ragSettings.endpoint, ragSettings.apiKey, ragSettings.useProxy); return ragClientRef.current.health(); }} />
    </>
  );
}
