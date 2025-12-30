/**
 * Chat state persistence layer using localStorage with optional IndexedDB for larger data
 */

const STORAGE_KEY = 'vllm_chat_state';
const STATE_VERSION = 1;
const EXPIRY_DAYS = 7;

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  model?: string;
  toolCalls?: unknown[];
  toolResults?: unknown[];
}

export interface PersistedChatState {
  version: number;
  currentSessionId: string | null;
  messages: PersistedMessage[];
  input: string;
  selectedModel: string;
  mcpEnabled: boolean;
  artifactsEnabled: boolean;
  systemPrompt: string;
  lastUpdated: number;
  sidebarCollapsed: boolean;
}

const defaultState: PersistedChatState = {
  version: STATE_VERSION,
  currentSessionId: null,
  messages: [],
  input: '',
  selectedModel: '',
  mcpEnabled: false,
  artifactsEnabled: false,
  systemPrompt: '',
  lastUpdated: Date.now(),
  sidebarCollapsed: true,
};

export function saveState(state: Partial<PersistedChatState>): void {
  try {
    const existing = loadState();
    const merged: PersistedChatState = {
      ...existing,
      ...state,
      version: STATE_VERSION,
      lastUpdated: Date.now(),
    };

    // Limit messages to last 100 to prevent storage bloat
    if (merged.messages.length > 100) {
      merged.messages = merged.messages.slice(-100);
    }

    // Remove base64 images from persisted state to save space
    merged.messages = merged.messages.map(m => ({
      ...m,
      images: undefined, // Don't persist images
    }));

    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (e) {
    console.warn('Failed to save chat state:', e);
  }
}

export function loadState(): PersistedChatState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...defaultState };

    const parsed = JSON.parse(stored) as PersistedChatState;

    // Check version and expiry
    if (parsed.version !== STATE_VERSION) {
      console.log('State version mismatch, clearing');
      clearState();
      return { ...defaultState };
    }

    const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - parsed.lastUpdated > expiryMs) {
      console.log('State expired, clearing');
      clearState();
      return { ...defaultState };
    }

    return parsed;
  } catch (e) {
    console.warn('Failed to load chat state:', e);
    return { ...defaultState };
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear chat state:', e);
  }
}

export function saveInputDraft(input: string): void {
  try {
    const state = loadState();
    state.input = input;
    state.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // Ignore - this is best effort
  }
}

// Debounced save function
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
export function debouncedSave(state: Partial<PersistedChatState>, delay = 500): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveState(state);
    saveTimeout = null;
  }, delay);
}
