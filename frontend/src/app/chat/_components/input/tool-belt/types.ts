import type { ReactNode } from "react";
import type { Attachment, ModelOption } from "../../../types";

export interface ToolBeltProps {
  onSubmit: (value: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  thinkingSnippet?: string;
  placeholder?: string;
  onStop?: () => void;
  onOpenResults?: () => void;
  selectedModel?: string;
  availableModels?: ModelOption[];
  onModelChange?: (modelId: string) => void;
  mcpEnabled?: boolean;
  onMcpToggle?: () => void;
  artifactsEnabled?: boolean;
  onArtifactsToggle?: () => void;
  onOpenMcpSettings?: () => void;
  onOpenChatSettings?: () => void;
  hasSystemPrompt?: boolean;
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: () => void;
  planDrawer?: ReactNode;
  callModeEnabled?: boolean;
  onCallModeToggle?: () => void;
}

