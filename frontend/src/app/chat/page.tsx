'use client';

import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Sparkles,
  User,
  Copy,
  Check,
  Plus,
  GitBranch,
  Settings,
  Globe,
  Code,
  Pencil,
  CheckCircle2,
  X,
  Download,
  BarChart3,
} from 'lucide-react';
import api from '@/lib/api';
import type { ChatSession, ToolCall, ToolResult, MCPTool } from '@/lib/types';
import {
  MessageRenderer, ChatSidebar, ToolBelt, MCPSettingsModal, ChatSettingsModal } from '@/components/chat';
import {
  ToolCallCard } from '@/components/chat/tool-call-card';
import type { Attachment, MCPServerConfig } from '@/components/chat';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[]; // base64 images for display
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

interface StreamEvent {
  type: 'text' | 'tool_calls' | 'done' | 'error';
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | {
      role: 'user' | 'assistant' | 'system';
      content: string | null | OpenAIContentPart[];
      tool_calls?: OpenAIToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      name?: string;
      content: string;
    };

const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripThinkingForModelContext = (text: string) => {
  if (!text) return text;
  let cleaned = text.replace(BOX_TAGS_PATTERN, '');
  // Preserve any "renderable" code fences that were placed inside <think> blocks (models sometimes do this),
  // but strip the rest of the thinking content so we don't feed back chain-of-thought.
  const preservedBlocks: string[] = [];
  cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, (block) => {
    const fenceRegex = /```([a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fenceRegex.exec(block)) !== null) {
      const lang = (m[1] || '').toLowerCase();
      const isRenderable =
        ['html', 'svg', 'javascript', 'js', 'react', 'jsx', 'tsx'].includes(lang) ||
        lang.startsWith('artifact-');
      if (isRenderable) {
        preservedBlocks.push(`\n\n\`\`\`${lang}\n${m[2].trim()}\n\`\`\``);
      }
    }
    return '';
  });
  cleaned = cleaned.replace(/<\/?think(?:ing)?>/gi, '');
  return (cleaned.trim() + preservedBlocks.join('')).trim();
};

const stripThinkTagsKeepText = (text: string) => {
  if (!text) return text;
  return text.replace(/<\/?think(?:ing)?>/gi, '');
};

export default function ChatPage() {
  // Session state
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsAvailable, setSessionsAvailable] = useState(true);

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Model state
  const [runningModel, setRunningModel] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; root?: string; max_model_len?: number }>>([]);
  const [pageLoading, setPageLoading] = useState(true);

  // UI state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // MCP & Artifacts state
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<MCPTool[]>([]);
  const [executingTools, setExecutingTools] = useState<Set<string>>(new Set());
  const [toolResultsMap, setToolResultsMap] = useState<Map<string, ToolResult>>(new Map());

  // Chat settings state
  const [systemPrompt, setSystemPrompt] = useState('');
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string>('New Chat');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [sessionUsage, setSessionUsage] = useState<{
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    estimated_cost_usd?: number | null;
  } | null>(null);
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const usageRefreshTimerRef = useRef<number | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    loadStatus();
    loadSessions();
    loadMCPServers();
    loadAvailableModels();
  }, []);

  const loadAvailableModels = async () => {
    try {
      const res = await api.getOpenAIModels();
      const data = Array.isArray(res.data) ? res.data : [];
      setAvailableModels(data.map((m) => ({ id: m.id, root: m.root, max_model_len: m.max_model_len })));
    } catch (e) {
      console.log('OpenAI models endpoint not available:', e);
      setAvailableModels([]);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (mcpEnabled) {
      loadMCPTools();
    } else {
      setMcpTools([]);
    }
  }, [mcpEnabled]);

  const loadMCPServers = async () => {
    try {
      const servers = await api.getMCPServers();
      setMcpServers(servers.map((s) => ({ ...s, args: s.args || [], env: s.env || {}, enabled: s.enabled ?? true })));
    } catch (e) {
      console.log('MCP servers not available:', e);
    }
  };

  const loadMCPTools = async () => {
    try {
      const response = await api.getMCPTools();
      setMcpTools(response.tools || []);
      console.log('[MCP] Loaded tools:', response.tools?.length || 0);
    } catch (e) {
      console.log('MCP tools not available:', e);
      setMcpTools([]);
    }
  };

  const loadStatus = async () => {
    try {
      const status = await api.getStatus();
      if (status.process) {
        const modelId =
          status.process.served_model_name ||
          status.process.model_path ||
          'default';
        setRunningModel(modelId);
        setModelName(
          status.process.model_path?.split('/').pop() ||
            'Model'
        );
        setSelectedModel((prev) => prev || modelId);
      }
    } catch (e) {
      console.error('Failed to load status:', e);
    } finally {
      setPageLoading(false);
    }
  };

  const loadSessions = async () => {
    try {
      const data = await api.getChatSessions();
      setSessions(data.sessions);
      setSessionsAvailable(true);
      if (currentSessionId) {
        const found = data.sessions.find((s) => s.id === currentSessionId);
        if (found?.title) setCurrentSessionTitle(found.title);
      }
    } catch (e) {
      console.log('Chat sessions API not available', e);
      setSessionsAvailable(false);
    } finally {
      setSessionsLoading(false);
    }
  };

  const refreshUsage = (sessionId: string) => {
    if (!sessionId) return;
    if (usageRefreshTimerRef.current) {
      window.clearTimeout(usageRefreshTimerRef.current);
    }
    usageRefreshTimerRef.current = window.setTimeout(async () => {
      try {
        const usage = await api.getChatUsage(sessionId);
        setSessionUsage({
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          estimated_cost_usd: usage.estimated_cost_usd ?? null,
        });
      } catch {
        // ignore
      }
    }, 350);
  };

  const loadSession = async (sessionId: string) => {
    try {
      const data = await api.getChatSession(sessionId);
      const session = data.session;
      const loadedToolResults = new Map<string, ToolResult>();
      const loadedMessages: Message[] = (session.messages || [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => {
          const base: Message = {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            model: m.model,
            prompt_tokens: (m as any).prompt_tokens,
            completion_tokens: (m as any).completion_tokens,
            total_tokens: (m as any).total_tokens,
            request_prompt_tokens: (m as any).request_prompt_tokens ?? null,
            request_tools_tokens: (m as any).request_tools_tokens ?? null,
            request_total_input_tokens: (m as any).request_total_input_tokens ?? null,
            request_completion_tokens: (m as any).request_completion_tokens ?? null,
            estimated_cost_usd: (m as any).estimated_cost_usd ?? null,
          };

          if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
            const toolCalls: ToolCall[] = [];
            const toolResults: ToolResult[] = [];

            for (const entry of m.tool_calls) {
              const tc = entry as any;
              if (!tc || typeof tc !== 'object') continue;
              if (typeof tc.id !== 'string' || !tc.function || typeof tc.function.name !== 'string') continue;
              toolCalls.push({
                id: tc.id,
                type: 'function',
                function: {
                  name: String(tc.function.name),
                  arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? ''),
                },
              });

              const res = tc.result as any;
              if (res && typeof res === 'object' && typeof res.content === 'string') {
                const toolResult: ToolResult = {
                  tool_call_id: tc.id,
                  content: res.content,
                  isError: Boolean(res.isError),
                };
                toolResults.push(toolResult);
                loadedToolResults.set(tc.id, toolResult);
              }
            }

            if (toolCalls.length > 0) {
              base.toolCalls = toolCalls;
            }
            if (toolResults.length > 0) {
              base.toolResults = toolResults;
            }
          }

          return base;
        });
      setMessages(loadedMessages);
      setToolResultsMap(loadedToolResults);
      setExecutingTools(new Set());
      setCurrentSessionId(sessionId);
      if (session.model) setSelectedModel(session.model);
      setCurrentSessionTitle(session.title || 'Chat');
      setEditingTitle(false);
      setTitleDraft(session.title || '');
      refreshUsage(sessionId);
    } catch (e) {
      console.error('Failed to load session:', e);
      setError('Failed to load conversation');
    }
  };

  const createSession = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setError(null);
    setSelectedModel(runningModel || availableModels[0]?.id || '');
    setCurrentSessionTitle('New Chat');
    setSessionUsage(null);
    setEditingTitle(false);
    setTitleDraft('');
    setTimeout(() => {
      const inputEl = document.querySelector('textarea');
      inputEl?.focus();
    }, 100);
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await api.deleteChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to delete session:', e);
    }
  };

  // Parse SSE events from the stream
  const parseSSEEvents = async function* (reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data) {
            try {
              yield JSON.parse(data) as StreamEvent;
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    }
  };

  // Build API messages with system prompt
  const buildAPIMessages = (msgs: Message[]) => {
    const apiMessages: OpenAIMessage[] = [];

    // Prepend system prompt if set
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    if (mcpEnabled) {
      apiMessages.push({
        role: 'system',
        content:
          'When you need a tool, emit tool_calls immediately (no preface). Do not repeat the same tool call with identical arguments; use tool results and then answer.',
      });
    }
    if (artifactsEnabled) {
      apiMessages.push({
        role: 'system',
        content:
          'If you output code intended for preview (HTML/SVG/JS/JSX/TSX), put it in the normal response (not inside <think> blocks) and wrap it in a fenced code block (```lang ... ```).',
      });
    }

    for (const m of msgs) {
      if (m.images && m.images.length > 0) {
        const content: OpenAIContentPart[] = [];
        if (m.content) {
          content.push({ type: 'text', text: m.content });
        }
        for (const base64 of m.images) {
          content.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          });
        }
        apiMessages.push({ role: m.role, content });
        continue;
      }

      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        // Include content (stripped of thinking) so model remembers context
        const cleanedContent = stripThinkingForModelContext(m.content);
        apiMessages.push({
          role: 'assistant',
          content: cleanedContent || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });

        const nameById = new Map(m.toolCalls.map((tc) => [tc.id, tc.function.name]));
        for (const result of m.toolResults || []) {
          apiMessages.push({
            role: 'tool',
            tool_call_id: result.tool_call_id,
            name: nameById.get(result.tool_call_id),
            content: result.content,
          });
        }
        continue;
      }

      const content =
        m.role === 'assistant' ? stripThinkingForModelContext(m.content) : m.content;
      apiMessages.push({ role: m.role, content });
    }

    return apiMessages;
  };

  // Convert MCP tools to OpenAI function format
  const getOpenAITools = () => {
    if (!mcpEnabled || mcpTools.length === 0) return undefined;
    return mcpTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: `${tool.server}__${tool.name}`,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  };

  // Execute an MCP tool call
  const executeMCPTool = async (toolCall: ToolCall): Promise<ToolResult> => {
    const funcName = toolCall.function.name;

    const resolveMcpTool = (name: string): { server: string; toolName: string; schema?: MCPTool } | null => {
      const trimmed = (name || '').trim();
      if (!trimmed) return null;

      // Preferred format: `${server}__${tool}`
      if (trimmed.includes('__')) {
        const [server, ...nameParts] = trimmed.split('__');
        const toolName = nameParts.join('__');
        if (!server || !toolName) return null;
        const schema = mcpTools.find((t) => t.server === server && t.name === toolName);
        return { server, toolName, schema };
      }

      // Some models output only the tool name; try exact match across servers.
      const exact = mcpTools.find((t) => t.name === trimmed);
      if (exact) return { server: exact.server, toolName: exact.name, schema: exact };

      const lower = trimmed.toLowerCase();
      const haystack = (t: MCPTool) => `${t.name} ${t.description || ''}`.toLowerCase();

      // Common aliases
      const isSearch = /(^|_|\b)(search|web|browse|brave)(\b|_)/.test(lower);
      const isFetch = /(^|_|\b)(fetch|http|url|download|read)(\b|_)/.test(lower);

      let candidates = mcpTools;
      if (isSearch) {
        candidates = candidates.filter((t) => /search|brave|web/.test(haystack(t)));
      } else if (isFetch) {
        candidates = candidates.filter((t) => /fetch|http|url|download|read/.test(haystack(t)));
      }

      return candidates.length > 0 ? { server: candidates[0].server, toolName: candidates[0].name, schema: candidates[0] } : null;
    };

    const resolved = resolveMcpTool(funcName);
    const server = resolved?.server || '';
    const toolName = resolved?.toolName || '';

    const parseToolArgs = (raw: string | undefined): Record<string, unknown> => {
      const text = (raw || '').trim();
      if (!text) return {};
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
        return { input: parsed };
      } catch {
        // Try to extract the last valid JSON object/array from a concatenated string
        let lastParsed: unknown = undefined;
        for (let start = 0; start < text.length; start++) {
          const startChar = text[start];
          if (startChar !== '{' && startChar !== '[') continue;
          const endChar = startChar === '{' ? '}' : ']';
          let depth = 0;
          let inString = false;
          let escape = false;

          for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (inString) {
              if (escape) {
                escape = false;
              } else if (ch === '\\\\') {
                escape = true;
              } else if (ch === '"') {
                inString = false;
              }
              continue;
            }

            if (ch === '"') {
              inString = true;
              continue;
            }

            if (ch === startChar) depth++;
            if (ch === endChar) depth--;

            if (depth === 0) {
              const candidate = text.slice(start, i + 1);
              try {
                lastParsed = JSON.parse(candidate);
              } catch {
                // ignore
              }
              break;
            }
          }
        }

        if (lastParsed !== undefined) {
          if (lastParsed && typeof lastParsed === 'object' && !Array.isArray(lastParsed)) {
            return lastParsed as Record<string, unknown>;
          }
          return { input: lastParsed };
        }

        return { raw: text };
      }
    };

    try {
      if (!resolved) {
        const available = mcpTools.slice(0, 12).map((t) => `${t.server}__${t.name}`).join(', ');
        return {
          tool_call_id: toolCall.id,
          content: `Error: Unknown tool "${funcName}". Available tools include: ${available}${mcpTools.length > 12 ? ', ...' : ''}`,
          isError: true,
        };
      }

      let args = parseToolArgs(toolCall.function.arguments);

      // Heuristic coercions for common "input" shapes.
      const schema = resolved.schema;
      const schemaProps = (schema?.input_schema as any)?.properties as Record<string, any> | undefined;
      const wantsQuery = !!schemaProps && Object.prototype.hasOwnProperty.call(schemaProps, 'query');
      const wantsUrl = !!schemaProps && (Object.prototype.hasOwnProperty.call(schemaProps, 'url') || Object.prototype.hasOwnProperty.call(schemaProps, 'uri'));

      const tryParseNestedJsonString = (value: unknown): Record<string, unknown> | null => {
        if (typeof value !== 'string') return null;
        const nested = parseToolArgs(value);
        if (nested && typeof nested === 'object') return nested;
        return null;
      };

      if (args && typeof args === 'object' && 'input' in args) {
        const input = (args as any).input;
        if (wantsQuery && (typeof input === 'string' || Array.isArray(input))) {
          const query = Array.isArray(input) ? String(input[0] ?? '') : String(input);
          args = { query, ...(typeof (args as any).count === 'number' ? { count: (args as any).count } : { count: 5 }) };
        } else if (wantsUrl && (typeof input === 'string' || Array.isArray(input))) {
          const url = Array.isArray(input) ? String(input[0] ?? '') : String(input);
          args = { url };
        }
      }

      // Some models stuff the real args into a `raw` string (sometimes even concatenated JSON).
      if (args && typeof args === 'object' && 'raw' in args && typeof (args as any).raw === 'string') {
        const nested = tryParseNestedJsonString((args as any).raw);
        if (nested) {
          if (wantsQuery && !('query' in args) && ('query' in nested || 'input' in nested)) {
            const query =
              typeof (nested as any).query === 'string'
                ? (nested as any).query
                : typeof (nested as any).input === 'string'
                  ? (nested as any).input
                  : '';
            const count = typeof (nested as any).count === 'number' ? (nested as any).count : 5;
            if (query) args = { query, count };
          } else if (wantsUrl && !('url' in args) && !('uri' in args) && ('url' in nested || 'uri' in nested || 'input' in nested)) {
            const url =
              typeof (nested as any).url === 'string'
                ? (nested as any).url
                : typeof (nested as any).uri === 'string'
                  ? (nested as any).uri
                  : typeof (nested as any).input === 'string'
                    ? (nested as any).input
                    : '';
            if (url) args = { url };
          }
        }
      }

      console.log(`[MCP] Calling ${server}/${toolName}`, args);
      const result = await api.callMCPTool(server, toolName, args);
      return {
        tool_call_id: toolCall.id,
        content: typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
      };
    } catch (error) {
      console.error(`[MCP] Tool error:`, error);
      return {
        tool_call_id: toolCall.id,
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  };

  const sendMessage = async (attachments?: Attachment[]) => {
    const hasText = input.trim().length > 0;
    const hasAttachments = attachments && attachments.length > 0;

    const activeModelId = (selectedModel || runningModel || '').trim();
    if ((!hasText && !hasAttachments) || !activeModelId || isLoading) return;

    const userContent = input.trim();
    const imageAttachments = attachments?.filter((a) => a.type === 'image' && a.base64) || [];

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent || (imageAttachments.length > 0 ? '[Image]' : ''),
      images: imageAttachments.map((a) => a.base64!),
      model: activeModelId,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    abortControllerRef.current = new AbortController();

    // Track conversation for tool calling loop
    const conversationMessages = buildAPIMessages([...messages, userMessage]);
    let sessionId = currentSessionId;
    const isNewSession = !sessionId;
    let finalAssistantContent = '';

    const bumpSessionUpdatedAt = () => {
      if (!sessionId) return;
      setSessions((prev) => {
        const now = new Date().toISOString();
        const existing = prev.find((s) => s.id === sessionId);
        const updated = existing ? { ...existing, updated_at: now } : undefined;
        const rest = prev.filter((s) => s.id !== sessionId);
        return updated ? [updated, ...rest] : prev;
      });
    };

    try {
      // Create session early so it shows in the sidebar immediately.
      if (!sessionId) {
        try {
          const { session } = await api.createChatSession({ title: 'New Chat', model: activeModelId || undefined });
          sessionId = session.id;
          setCurrentSessionId(sessionId);
          setSessions((prev) => [session, ...prev]);
          setSessionsAvailable(true);
        } catch (e) {
          console.log('Failed to create chat session (continuing without persistence):', e);
        }
      }

      // Persist the user message up-front (best-effort).
      if (sessionId) {
        try {
          const persisted = await api.addChatMessage(sessionId, {
            id: userMessage.id,
            role: 'user',
            content: userContent,
            model: activeModelId || undefined,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === persisted.id
                ? {
                    ...m,
                    model: persisted.model || m.model,
                    prompt_tokens: (persisted as any).prompt_tokens,
                    completion_tokens: (persisted as any).completion_tokens,
                    total_tokens: (persisted as any).total_tokens,
                    request_prompt_tokens: (persisted as any).request_prompt_tokens ?? null,
                    request_tools_tokens: (persisted as any).request_tools_tokens ?? null,
                    request_total_input_tokens: (persisted as any).request_total_input_tokens ?? null,
                    request_completion_tokens: (persisted as any).request_completion_tokens ?? null,
                    estimated_cost_usd: (persisted as any).estimated_cost_usd ?? null,
                  }
                : m
            )
          );
          bumpSessionUpdatedAt();
          setSessionsAvailable(true);
          refreshUsage(sessionId);
        } catch (e) {
          console.log('Failed to persist user message:', e);
        }
      }

      // Tool calling loop - continues until no more tool calls
      let iteration = 0;
      const MAX_ITERATIONS = 10;
      const cachedToolResultsBySignature = new Map<string, Omit<ToolResult, 'tool_call_id'>>();

      while (iteration < MAX_ITERATIONS) {
        iteration++;

        // Estimate prompt tokens for this model call (messages + tools).
        let requestPromptTokens: number | null = null;
        let requestToolsTokens: number | null = null;
        let requestTotalInputTokens: number | null = null;
        try {
          const toolsForTokenize = getOpenAITools();
          const tok = await api.tokenizeChatCompletions({
            model: activeModelId,
            messages: conversationMessages as unknown[],
            tools: toolsForTokenize as unknown[] | undefined,
          });
          requestTotalInputTokens = tok.input_tokens ?? null;
          requestPromptTokens = tok.breakdown?.messages ?? null;
          requestToolsTokens = tok.breakdown?.tools ?? null;
        } catch (e) {
          // tokenization is best-effort
        }

        // Debug: Log message roles for tool call debugging
        const msgRoles = conversationMessages.map((m: any) =>
          `${m.role}${m.tool_call_id ? `(${m.tool_call_id.slice(0,8)})` : m.tool_calls ? `[${m.tool_calls.length}]` : ''}`
        ).join(', ');
        console.log(`[Tool Loop] ========== ITERATION ${iteration} ==========`);
        console.log(`[Tool Loop] Sending ${conversationMessages.length} messages: ${msgRoles}`);

        // Log the last few messages to verify tool results are included
        const lastMsgs = conversationMessages.slice(-5);
        console.log('[Tool Loop] Last 5 messages being sent:', JSON.stringify(lastMsgs, (key, value) => {
          // Truncate long content for readability
          if (key === 'content' && typeof value === 'string' && value.length > 300) {
            return value.slice(0, 300) + '... [truncated]';
          }
          return value;
        }, 2));

        const requestBody = {
          messages: conversationMessages,
          model: activeModelId,
          tools: getOpenAITools(),
        };

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current?.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        // Create a new assistant message per iteration (tool loops are multiple assistant turns).
        const assistantMsgId = (Date.now() + iteration).toString();
        setMessages((prev) => [...prev, { id: assistantMsgId, role: 'assistant', content: '', isStreaming: true, model: activeModelId }]);

        let iterationContent = '';
        let toolCalls: ToolCall[] = [];

        // Process SSE events
        for await (const event of parseSSEEvents(reader)) {
          if (event.type === 'text' && event.content) {
            iterationContent += event.content;
            setMessages((prev) => {
              return prev.map((m) => (m.id === assistantMsgId ? { ...m, content: iterationContent } : m));
            });
          } else if (event.type === 'tool_calls' && event.tool_calls) {
            toolCalls = event.tool_calls;
            // Update message with tool calls
            setMessages((prev) => {
              return prev.map((m) => (m.id === assistantMsgId ? { ...m, toolCalls } : m));
            });
          } else if (event.type === 'error') {
            throw new Error(event.error || 'Stream error');
          }
        }

        // Parse tool calls from text content (for models that output JSON instead of using function calling)
        if (toolCalls.length === 0 && mcpEnabled && iterationContent) {
          const parseTextToolCalls = (text: string): ToolCall[] => {
            const parsed: ToolCall[] = [];
            // Match patterns like {"tool_code": "...", "parameters": {...}} or {"tool": "...", "args": {...}}
            const jsonPatterns = [
              /\{\s*"tool_code"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[^}]*\})\s*\}/g,
              /\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"(?:args|arguments|parameters)"\s*:\s*(\{[^}]*\})\s*\}/g,
              /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:args|arguments|parameters)"\s*:\s*(\{[^}]*\})\s*\}/g,
            ];
            for (const pattern of jsonPatterns) {
              let match;
              while ((match = pattern.exec(text)) !== null) {
                const toolName = match[1];
                const args = match[2];
                // Find the matching MCP tool
                const mcpTool = mcpTools.find(t =>
                  t.name === toolName ||
                  t.name.toLowerCase() === toolName.toLowerCase() ||
                  `${t.server}__${t.name}` === toolName
                );
                if (mcpTool) {
                  parsed.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    type: 'function',
                    function: {
                      name: `${mcpTool.server}__${mcpTool.name}`,
                      arguments: args,
                    },
                  });
                }
              }
            }
            return parsed;
          };

          const textToolCalls = parseTextToolCalls(iterationContent);
          if (textToolCalls.length > 0) {
            console.log('[Tool Parse] Found tool calls in text output:', textToolCalls);
            toolCalls = textToolCalls;
            setMessages((prev) => prev.map((m) => (m.id === assistantMsgId ? { ...m, toolCalls } : m)));
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          finalAssistantContent = iterationContent;
          setMessages((prev) => {
            return prev.map((m) => (m.id === assistantMsgId ? { ...m, isStreaming: false } : m));
          });

          // Persist final assistant message (best-effort).
          if (sessionId) {
            try {
              let requestCompletionTokens: number | null = null;
              try {
                const counted = await api.countTextTokens({ model: activeModelId, text: stripThinkTagsKeepText(iterationContent) });
                requestCompletionTokens = counted.num_tokens ?? null;
              } catch {
                // ignore
              }

              const persisted = await api.addChatMessage(sessionId, {
                id: assistantMsgId,
                role: 'assistant',
                content: iterationContent,
                model: activeModelId || undefined,
                request_prompt_tokens: requestPromptTokens,
                request_tools_tokens: requestToolsTokens,
                request_total_input_tokens: requestTotalInputTokens,
                request_completion_tokens: requestCompletionTokens,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === persisted.id
                    ? {
                        ...m,
                        model: persisted.model || m.model,
                        prompt_tokens: (persisted as any).prompt_tokens,
                        completion_tokens: (persisted as any).completion_tokens,
                        total_tokens: (persisted as any).total_tokens,
                        request_prompt_tokens: (persisted as any).request_prompt_tokens ?? null,
                        request_tools_tokens: (persisted as any).request_tools_tokens ?? null,
                        request_total_input_tokens: (persisted as any).request_total_input_tokens ?? null,
                        request_completion_tokens: (persisted as any).request_completion_tokens ?? null,
                        estimated_cost_usd: (persisted as any).estimated_cost_usd ?? null,
                      }
                    : m
                )
              );
              bumpSessionUpdatedAt();
              setSessionsAvailable(true);
              refreshUsage(sessionId);
            } catch (e) {
              console.log('Failed to persist assistant message:', e);
            }
          }
          break;
        }

        // Execute tool calls
        console.log(`[MCP] Executing ${toolCalls.length} tool call(s)`);
        const toolResults: ToolResult[] = [];
        const toolNameByCallId = new Map<string, string>();

        for (const tc of toolCalls) {
          const signature = (() => {
            const name = tc.function?.name || '';
            const rawArgs = (tc.function?.arguments || '').trim();
            try {
              const parsed = rawArgs ? JSON.parse(rawArgs) : {};
              return `${name}:${JSON.stringify(parsed)}`;
            } catch {
              return `${name}:${rawArgs}`;
            }
          })();

          toolNameByCallId.set(tc.id, tc.function.name);

          // If the model repeats the exact same call, don't re-run it; return a cached result so it can proceed.
          if (cachedToolResultsBySignature.has(signature)) {
            const cached = cachedToolResultsBySignature.get(signature)!;
            const result: ToolResult = {
              tool_call_id: tc.id,
              content: cached.content,
              isError: cached.isError,
            };
            toolResults.push(result);
            setToolResultsMap((prev) => new Map(prev).set(tc.id, result));
            continue;
          }

          setExecutingTools((prev) => new Set(prev).add(tc.id));
          const result = await executeMCPTool(tc);
          cachedToolResultsBySignature.set(signature, { content: result.content, isError: result.isError });
          toolResults.push(result);
          setToolResultsMap((prev) => new Map(prev).set(tc.id, result));
          setExecutingTools((prev) => {
            const next = new Set(prev);
            next.delete(tc.id);
            return next;
          });
        }

        // Update message with results
        setMessages((prev) => {
          return prev.map((m) =>
            m.id === assistantMsgId ? { ...m, toolResults, isStreaming: false } : m
          );
        });

        // Persist the tool-call assistant turn (best-effort).
        if (sessionId) {
          try {
            const toolCallsForPersistence = toolCalls.map((tc) => {
              const result = toolResults.find((r) => r.tool_call_id === tc.id);
              return { ...tc, result: result || null };
            });

            let requestCompletionTokens: number | null = null;
            try {
              const counted = await api.countTextTokens({ model: activeModelId, text: stripThinkTagsKeepText(iterationContent) });
              requestCompletionTokens = counted.num_tokens ?? null;
            } catch {
              // ignore
            }

            const persisted = await api.addChatMessage(sessionId, {
              id: assistantMsgId,
              role: 'assistant',
              content: iterationContent,
              model: activeModelId || undefined,
              tool_calls: toolCallsForPersistence,
              request_prompt_tokens: requestPromptTokens,
              request_tools_tokens: requestToolsTokens,
              request_total_input_tokens: requestTotalInputTokens,
              request_completion_tokens: requestCompletionTokens,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === persisted.id
                  ? {
                      ...m,
                      model: persisted.model || m.model,
                      prompt_tokens: (persisted as any).prompt_tokens,
                      completion_tokens: (persisted as any).completion_tokens,
                      total_tokens: (persisted as any).total_tokens,
                      request_prompt_tokens: (persisted as any).request_prompt_tokens ?? null,
                      request_tools_tokens: (persisted as any).request_tools_tokens ?? null,
                      request_total_input_tokens: (persisted as any).request_total_input_tokens ?? null,
                      request_completion_tokens: (persisted as any).request_completion_tokens ?? null,
                      estimated_cost_usd: (persisted as any).estimated_cost_usd ?? null,
                    }
                  : m
              )
            );
            bumpSessionUpdatedAt();
            setSessionsAvailable(true);
            refreshUsage(sessionId);
          } catch (e) {
            console.log('Failed to persist tool-call turn:', e);
          }
        }

        // Add assistant message with tool calls to conversation
        // Include cleaned content so model remembers what it said
        const cleanedIterationContent = stripThinkingForModelContext(iterationContent);
        const assistantMsgForConv = {
          role: 'assistant' as const,
          content: cleanedIterationContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        };
        conversationMessages.push(assistantMsgForConv);
        console.log('[Tool Loop] Added assistant message with tool_calls:', JSON.stringify(assistantMsgForConv, null, 2));

        // Add tool results to conversation - MUST follow the assistant message with tool_calls
        for (const result of toolResults) {
          const toolName = toolNameByCallId.get(result.tool_call_id) || 'unknown_tool';
          const toolMsg = {
            role: 'tool' as const,
            tool_call_id: result.tool_call_id,
            name: toolName,
            content: result.content,
          };
          conversationMessages.push(toolMsg);
          console.log(`[Tool Loop] Added tool result for ${toolName}:`, {
            tool_call_id: result.tool_call_id,
            content_preview: result.content.slice(0, 200) + (result.content.length > 200 ? '...' : ''),
          });
        }

        // Log the full conversation that will be sent on next iteration
        const msgSummary = conversationMessages.map((m: any) => {
          if (m.role === 'tool') return `tool(${m.tool_call_id?.slice(0, 8)})`;
          if (m.role === 'assistant' && m.tool_calls) return `assistant[${m.tool_calls.length} calls]`;
          return m.role;
        }).join(' -> ');
        console.log(`[Tool Loop] Next iteration will send ${conversationMessages.length} messages: ${msgSummary}`);
      }

      // Auto-title new sessions after the final assistant response (best-effort).
      if (isNewSession && sessionId && finalAssistantContent.trim()) {
        try {
          const res = await fetch('/api/title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: activeModelId, user: userContent, assistant: finalAssistantContent }),
          });
          if (res.ok) {
            const data = (await res.json().catch(() => null)) as { title?: string } | null;
            const title = (data?.title || '').trim();
            if (title) {
              await api.updateChatSession(sessionId, { title });
              setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
              setCurrentSessionTitle(title);
              setTitleDraft(title);
            }
          }
        } catch (titleError) {
          console.log('Auto-title failed:', titleError);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m) => (m.id === last.id ? { ...m, isStreaming: false } : m));
          }
          return prev;
        });
      } else {
        setError(err instanceof Error ? err.message : 'Failed to send message');
        setMessages((prev) => {
          if (prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]?.content === '') {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const forkAtMessage = async (messageId: string) => {
    if (!currentSessionId) return;
    try {
      const { session } = await api.forkChatSession(currentSessionId, {
        message_id: messageId,
        model: (selectedModel || undefined) as string | undefined,
      });
      setSessions((prev) => [session, ...prev]);
      await loadSession(session.id);
    } catch (e) {
      console.log('Fork failed:', e);
      alert('Failed to fork chat');
    }
  };

  const saveTitle = async () => {
    if (!currentSessionId) {
      setEditingTitle(false);
      return;
    }
    const next = titleDraft.trim();
    if (!next) {
      setEditingTitle(false);
      return;
    }
    try {
      await api.updateChatSession(currentSessionId, { title: next });
      setSessions((prev) => prev.map((s) => (s.id === currentSessionId ? { ...s, title: next } : s)));
      setCurrentSessionTitle(next);
    } catch (e) {
      console.log('Failed to update title:', e);
    } finally {
      setEditingTitle(false);
    }
  };

  const buildChatExport = () => {
    const title = currentSessionTitle || 'Chat';
    const exported = {
      title,
      session_id: currentSessionId,
      model: selectedModel || runningModel || null,
      created_at: sessions.find((s) => s.id === currentSessionId)?.created_at ?? null,
      updated_at: sessions.find((s) => s.id === currentSessionId)?.updated_at ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        model: m.model ?? null,
        content: m.content,
        tool_calls: m.toolCalls ?? null,
        tool_results: m.toolResults ?? null,
        usage: {
          prompt_tokens: m.prompt_tokens ?? null,
          completion_tokens: m.completion_tokens ?? null,
          total_tokens: m.total_tokens ?? null,
          request_prompt_tokens: m.request_prompt_tokens ?? null,
          request_tools_tokens: m.request_tools_tokens ?? null,
          request_total_input_tokens: m.request_total_input_tokens ?? null,
          request_completion_tokens: m.request_completion_tokens ?? null,
          estimated_cost_usd: m.estimated_cost_usd ?? null,
        },
      })),
      session_usage: sessionUsage,
    };
    return exported;
  };

  const downloadText = (filename: string, content: string, mime = 'text/plain') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportAsJson = () => {
    const payload = buildChatExport();
    const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80);
    downloadText(`${name}.json`, JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportAsMarkdown = () => {
    const payload = buildChatExport();
    const lines: string[] = [];
    lines.push(`# ${payload.title}`);
    if (payload.model) lines.push(`- Model: \`${payload.model}\``);
    if (payload.session_id) lines.push(`- Session: \`${payload.session_id}\``);
    if (payload.session_usage) {
      const cost =
        payload.session_usage.estimated_cost_usd != null
          ? ` • $${payload.session_usage.estimated_cost_usd.toFixed(4)}`
          : '';
      lines.push(`- Usage: ${payload.session_usage.total_tokens.toLocaleString()} tok${cost}`);
    }
    lines.push('');

    for (const m of payload.messages) {
      const who = m.role === 'user' ? 'User' : `Assistant${m.model ? ` (${m.model})` : ''}`;
      lines.push(`## ${who}`);
      lines.push('');
      lines.push(m.content || '');
      lines.push('');
      if (m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        lines.push('### Tool calls');
        lines.push('```json');
        lines.push(JSON.stringify(m.tool_calls, null, 2));
        lines.push('```');
        lines.push('');
      }
      if (m.tool_results && Array.isArray(m.tool_results) && m.tool_results.length > 0) {
        lines.push('### Tool results');
        lines.push('```json');
        lines.push(JSON.stringify(m.tool_results, null, 2));
        lines.push('```');
        lines.push('');
      }
    }

    const name = (currentSessionTitle || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 80);
    downloadText(`${name}.md`, lines.join('\n'), 'text/markdown');
  };

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse-soft">
          <Sparkles className="h-8 w-8 text-[var(--muted)]" />
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="relative">
      {/* Sidebar */}
      <ChatSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={loadSession}
        onNewSession={createSession}
        onDeleteSession={deleteSession}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isLoading={sessionsLoading}
        isMobile={isMobile}
      />

      {/* Main Chat Area */}
      <div className={`${sidebarCollapsed || isMobile ? '' : 'md:ml-64'}`}>
        {/* Chat Header - compact on mobile */}
        <div className="sticky top-12 z-40 bg-[var(--card)] border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-1.5 md:gap-3 px-2 md:px-4 py-1.5 md:py-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 min-w-0">
              {/* Mobile: History button */}
              {isMobile && (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="p-1.5 -ml-1 rounded-lg hover:bg-[var(--accent)] transition-colors"
                  title="Chat history"
                >
                  <MessageSquare className="h-5 w-5" />
                </button>
              )}

              {editingTitle ? (
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    className="px-2 py-1 text-sm bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--foreground)] min-w-0 w-48 md:w-64"
                    placeholder="Chat title"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={saveTitle}
                    className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
                    title="Save title"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                  </button>
                  <button
                    onClick={() => setEditingTitle(false)}
                    className="p-1.5 rounded hover:bg-[var(--accent)] transition-colors"
                    title="Cancel"
                  >
                    <X className="h-4 w-4 text-[var(--muted)]" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-sm font-medium truncate max-w-[120px] md:max-w-none" title={currentSessionTitle}>
                    {currentSessionTitle || 'Chat'}
                  </div>
                  {currentSessionId && !isMobile && (
                    <button
                      onClick={() => {
                        setTitleDraft(currentSessionTitle);
                        setEditingTitle(true);
                      }}
                      className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
                      title="Rename chat"
                    >
                      <Pencil className="h-3.5 w-3.5 text-[var(--muted)]" />
                    </button>
                  )}
                  {selectedModel && !isMobile && (
                    <span className="text-[10px] font-mono text-[var(--muted)] px-2 py-0.5 border border-[var(--border)] rounded">
                      {selectedModel.split('/').pop()}
                    </span>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
              {/* Usage (desktop only) */}
              {!isMobile && currentSessionId && sessionUsage && (
                <button
                  onClick={() => setUsageDetailsOpen(true)}
                  className="text-[10px] font-mono text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                  title="Usage details"
                >
                  {sessionUsage.total_tokens.toLocaleString()} tok
                  {sessionUsage.estimated_cost_usd != null ? ` • $${sessionUsage.estimated_cost_usd.toFixed(4)}` : ''}
                </button>
              )}

              {/* Toggle buttons (desktop only) */}
              {!isMobile && (
                <>
                  <button
                    onClick={() => setMcpEnabled((v) => !v)}
                    className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors ${
                      mcpEnabled ? 'border-blue-500/40 bg-blue-500/10 text-blue-400' : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)]'
                    }`}
                    title="Toggle tools"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Tools
                  </button>
                  <button
                    onClick={() => setArtifactsEnabled((v) => !v)}
                    className={`flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors ${
                      artifactsEnabled ? 'border-purple-500/40 bg-purple-500/10 text-purple-400' : 'border-[var(--border)] text-[var(--muted)] hover:bg-[var(--accent)]'
                    }`}
                    title="Toggle previews"
                  >
                    <Code className="h-3.5 w-3.5" />
                    Preview
                  </button>
                </>
              )}

              {/* Action buttons */}
              <button
                onClick={() => setChatSettingsOpen(true)}
                className="p-1.5 md:p-2 rounded md:border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
                title="Chat settings"
              >
                <Settings className="h-4 w-4 text-[var(--muted)]" />
              </button>
              {!isMobile && (
                <>
                  <button
                    onClick={() => setExportOpen(true)}
                    className="p-2 rounded border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
                    title="Export chat"
                  >
                    <Download className="h-4 w-4 text-[var(--muted)]" />
                  </button>
                  <button
                    onClick={() => setUsageDetailsOpen(true)}
                    className="p-2 rounded border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
                    title="Usage details"
                  >
                    <BarChart3 className="h-4 w-4 text-[var(--muted)]" />
                  </button>
                </>
              )}
              <button
                onClick={createSession}
                className="p-1.5 md:p-2 rounded md:border border-[var(--border)] hover:bg-[var(--accent)] transition-colors"
                title="New chat"
              >
                <Plus className="h-4 w-4 text-[var(--muted)]" />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="pb-32 md:pb-28">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center min-h-[50vh]">
              <div className="text-center px-6 py-8 animate-fade-in">
                <div className="w-12 h-12 rounded-2xl bg-[var(--accent)] flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="h-6 w-6 text-[var(--muted-foreground)]" />
                </div>
                <h2 className="text-lg font-medium mb-2">Start a conversation</h2>
                <p className="text-sm text-[var(--muted)] max-w-xs mx-auto">
                  {selectedModel || runningModel
                    ? 'Send a message to begin chatting with your model.'
                    : 'Select a model in Settings to get started.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-4 px-2 md:px-4 space-y-1 w-full">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={`px-3 md:px-4 py-3 rounded-xl animate-slide-up ${
                      message.role === 'assistant' ? 'bg-[var(--card)]' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          message.role === 'user'
                            ? 'bg-[var(--accent)]'
                            : 'bg-[var(--success)]/15'
                        }`}
                      >
                        {message.role === 'user' ? (
                          <User className="h-3.5 w-3.5" />
                        ) : (
                          <Sparkles
                            className={`h-3.5 w-3.5 text-[var(--success)] ${
                              message.isStreaming ? 'animate-pulse-soft' : ''
                            }`}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-medium text-[var(--muted-foreground)]">
                            {message.role === 'user' ? 'You' : (message.model?.split('/').pop() || selectedModel?.split('/').pop() || modelName || 'Assistant')}
                          </span>
                          {(message.total_tokens || message.prompt_tokens || message.completion_tokens) && (
                            <span className="text-[10px] text-[var(--muted)] font-mono">
                              {(() => {
                                const reqPrompt = message.request_total_input_tokens ?? message.request_prompt_tokens;
                                const reqComp = message.request_completion_tokens;
                                if (message.role === 'assistant' && (reqPrompt || reqComp)) {
                                  const total = (reqPrompt || 0) + (reqComp || 0);
                                  return `${total.toLocaleString()} tok`;
                                }
                                const total = (message.total_tokens ?? (message.prompt_tokens || 0) + (message.completion_tokens || 0)) || 0;
                                return `${total.toLocaleString()} tok`;
                              })()}
                              {message.estimated_cost_usd != null ? ` • $${message.estimated_cost_usd.toFixed(4)}` : ''}
                            </span>
                          )}
                          {currentSessionId && (
                            <button
                              onClick={() => forkAtMessage(message.id)}
                              className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors"
                              title="Fork chat from here"
                            >
                              <GitBranch className="h-3 w-3 text-[var(--muted)]" />
                            </button>
                          )}
                          <button
                            onClick={() => copyToClipboard(message.content, index)}
                            className="p-0.5 rounded hover:bg-[var(--accent)] transition-colors"
                          >
                            {copiedIndex === index ? (
                              <Check className="h-3 w-3 text-[var(--success)]" />
                            ) : (
                              <Copy className="h-3 w-3 text-[var(--muted)]" />
                            )}
                          </button>
                        </div>

                        {/* Show images for user messages */}
                        {message.images && message.images.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {message.images.map((base64, i) => (
                              <img
                                key={i}
                                src={`data:image/jpeg;base64,${base64}`}
                                alt={`Uploaded image ${i + 1}`}
                                className="max-w-[150px] max-h-[150px] rounded border border-[var(--border)]"
                              />
                            ))}
                          </div>
                        )}

                        <div className="text-sm overflow-hidden break-words">
                          {message.role === 'user' ? (
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          ) : (
                            <>
                              <MessageRenderer
                                content={message.content}
                                isStreaming={message.isStreaming}
                                artifactsEnabled={artifactsEnabled}
                              />
                              {/* Tool Calls Display */}
                              {message.toolCalls && message.toolCalls.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {message.toolCalls.map((toolCall) => (
                                    <ToolCallCard
                                      key={toolCall.id}
                                      toolCall={toolCall}
                                      result={toolResultsMap.get(toolCall.id)}
                                      isExecuting={executingTools.has(toolCall.id)}
                                    />
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {isLoading &&
                  messages[messages.length - 1]?.role === 'assistant' &&
                  messages[messages.length - 1]?.content === '' && (
                    <div className="px-3 md:px-4 py-3 rounded-xl bg-[var(--card)]">
                      <div className="flex gap-3">
                        <div className="w-7 h-7 rounded-lg bg-[var(--success)]/15 flex items-center justify-center">
                          <Sparkles className="h-3.5 w-3.5 text-[var(--success)] animate-pulse-soft" />
                        </div>
                        <div className="flex items-center pt-1">
                          <div className="flex gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" />
                            <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 rounded-full bg-[var(--muted)] animate-pulse-soft" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                {error && (
                  <div className="mx-4 my-2 px-3 py-2 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded text-xs text-[var(--error)] animate-slide-up">
                    {error}
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fixed Input Tool Belt */}
      <div className={`fixed bottom-[10px] left-0 right-0 z-50 ${sidebarCollapsed || isMobile ? '' : 'md:left-64'}`}>
        <ToolBelt
          value={input}
          onChange={setInput}
          onSubmit={sendMessage}
          onStop={stopGeneration}
          disabled={!((selectedModel || runningModel || '').trim())}
          isLoading={isLoading}
          modelName={selectedModel || modelName}
          placeholder={(selectedModel || runningModel) ? 'Message...' : 'Select a model in Settings'}
          mcpEnabled={mcpEnabled}
          onMcpToggle={() => setMcpEnabled(!mcpEnabled)}
          mcpServers={mcpServers.map((s) => ({ name: s.name, enabled: s.enabled }))}
          artifactsEnabled={artifactsEnabled}
          onArtifactsToggle={() => setArtifactsEnabled(!artifactsEnabled)}
          onOpenMcpSettings={() => setMcpSettingsOpen(true)}
          onOpenChatSettings={() => setChatSettingsOpen(true)}
          hasSystemPrompt={systemPrompt.trim().length > 0}
        />
      </div>

      {/* Usage Details Modal */}
      {usageDetailsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[var(--muted)]" />
                  <h2 className="font-medium">Usage</h2>
                </div>
                <button
                  onClick={() => setUsageDetailsOpen(false)}
                  className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="bg-[var(--background)] rounded-lg p-3">
                    <div className="text-xs text-[var(--muted)]">Input</div>
                    <div className="text-lg font-mono font-semibold">
                      {(sessionUsage?.prompt_tokens ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3">
                    <div className="text-xs text-[var(--muted)]">Output</div>
                    <div className="text-lg font-mono font-semibold">
                      {(sessionUsage?.completion_tokens ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3">
                    <div className="text-xs text-[var(--muted)]">Total</div>
                    <div className="text-lg font-mono font-semibold">
                      {(sessionUsage?.total_tokens ?? 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-[var(--background)] rounded-lg p-3">
                    <div className="text-xs text-[var(--muted)]">Cost</div>
                    <div className="text-lg font-mono font-semibold">
                      {sessionUsage?.estimated_cost_usd != null ? `$${sessionUsage.estimated_cost_usd.toFixed(4)}` : '--'}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-[var(--muted)]">
                  Request-level token accounting is stored on assistant turns (`request_*` fields) when available.
                </div>

                <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-[var(--accent)] text-xs font-medium text-[var(--muted-foreground)]">
                    Recent assistant turns
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {messages
                      .filter((m) => m.role === 'assistant')
                      .slice(-20)
                      .reverse()
                      .map((m) => {
                        const inTok = (m.request_total_input_tokens ?? m.request_prompt_tokens ?? null) as number | null;
                        const outTok = (m.request_completion_tokens ?? null) as number | null;
                        const total = (inTok || 0) + (outTok || 0);
                        return (
                          <div key={m.id} className="px-3 py-2 border-t border-[var(--border)] flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs text-[var(--muted)] font-mono truncate">
                                {m.model || selectedModel || 'assistant'} • {m.id}
                              </div>
                              <div className="text-xs text-[var(--muted-foreground)] truncate">
                                {(m.content || '').replace(/\s+/g, ' ').slice(0, 80)}
                              </div>
                            </div>
                            <div className="text-[10px] font-mono text-[var(--muted)] text-right">
                              {total ? `${total.toLocaleString()} tok` : '--'}
                            </div>
                          </div>
                        );
                      })}
                    {messages.filter((m) => m.role === 'assistant').length === 0 && (
                      <div className="px-3 py-4 text-sm text-[var(--muted)]">No assistant messages yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => setUsageDetailsOpen(false)}
                  className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Export Modal */}
        {exportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg w-full max-w-lg overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-[var(--muted)]" />
                  <h2 className="font-medium">Export chat</h2>
                </div>
                <button
                  onClick={() => setExportOpen(false)}
                  className="p-1 rounded hover:bg-[var(--accent)] transition-colors"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div className="text-xs text-[var(--muted)]">
                  Exports use the current UI state (including tool calls/results if present).
                </div>
                <button
                  onClick={() => {
                    exportAsMarkdown();
                    setExportOpen(false);
                  }}
                  className="w-full px-3 py-2 text-sm bg-[var(--foreground)] text-[var(--background)] rounded hover:opacity-90"
                >
                  Download Markdown
                </button>
                <button
                  onClick={() => {
                    exportAsJson();
                    setExportOpen(false);
                  }}
                  className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)]"
                >
                  Download JSON
                </button>
              </div>

              <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
                <button
                  onClick={() => setExportOpen(false)}
                  className="px-4 py-1.5 text-sm border border-[var(--border)] rounded hover:bg-[var(--accent)] transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MCP Settings Modal */}
        <MCPSettingsModal
          isOpen={mcpSettingsOpen}
          onClose={() => setMcpSettingsOpen(false)}
          servers={mcpServers}
          onServersChange={(newServers) => {
            setMcpServers(newServers);
          }}
        />

        {/* Chat Settings Modal */}
        <ChatSettingsModal
          isOpen={chatSettingsOpen}
          onClose={() => setChatSettingsOpen(false)}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onSelectedModelChange={async (modelId) => {
            const next = (modelId || '').trim();
            setSelectedModel(next);
            if (currentSessionId) {
              try {
                await api.updateChatSession(currentSessionId, { model: next || undefined });
                setSessions((prev) => prev.map((s) => (s.id === currentSessionId ? { ...s, model: next } : s)));
              } catch (e) {
                console.log('Failed to persist chat model:', e);
              }
            }
          }}
          onForkModels={async (modelIds) => {
            const baseId = currentSessionId;
            if (!baseId) return;
            const created: string[] = [];
            for (const m of modelIds) {
              try {
                const { session } = await api.forkChatSession(baseId, { model: m, title: undefined });
                created.push(session.id);
                setSessions((prev) => [session, ...prev]);
              } catch (e) {
                console.log('Fork failed:', e);
              }
            }
            if (created.length > 0) {
              await loadSessions();
              await loadSession(created[0]);
            }
          }}
        />
    </>
  );
}
