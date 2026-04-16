// CRITICAL
export const AGENT_RUN_EVENT_TYPES = {
  RUN_START: "run_start",
  TURN_START: "turn_start",
  MESSAGE_START: "message_start",
  MESSAGE_UPDATE: "message_update",
  MESSAGE_END: "message_end",
  TOOL_EXECUTION_START: "tool_execution_start",
  TOOL_EXECUTION_UPDATE: "tool_execution_update",
  TOOL_EXECUTION_END: "tool_execution_end",
  TURN_END: "turn_end",
  AGENT_START: "agent_start",
  AGENT_END: "agent_end",
  RUN_END: "run_end",
  CHAT_USAGE_UPDATED: "chat_usage_updated",
  CHAT_MESSAGE_UPSERTED: "chat_message_upserted",
  CHAT_SESSION_CREATED: "chat_session_created",
  CHAT_SESSION_UPDATED: "chat_session_updated",
  CHAT_SESSION_COMPACTED: "chat_session_compacted",
  CHAT_SESSION_DELETED: "chat_session_deleted",
  CHAT_SESSION_FORKED: "chat_session_forked",
  PLAN_UPDATED: "plan_updated",
  AGENT_PLAN_UPDATED: "agent_plan_updated",
} as const;

export type AgentRunEventType = (typeof AGENT_RUN_EVENT_TYPES)[keyof typeof AGENT_RUN_EVENT_TYPES];

export const AGENT_FILE_EVENT_TYPES = {
  AGENT_FILES_LISTED: "agent_files_listed",
  AGENT_FILE_READ: "agent_file_read",
  AGENT_FILE_WRITTEN: "agent_file_written",
  AGENT_FILE_EDITED: "agent_file_edited",
  AGENT_FILE_DELETED: "agent_file_deleted",
  AGENT_DIRECTORY_CREATED: "agent_directory_created",
  AGENT_FILE_MOVED: "agent_file_moved",
} as const;

export type AgentFileEventType =
  (typeof AGENT_FILE_EVENT_TYPES)[keyof typeof AGENT_FILE_EVENT_TYPES];

export type AgentEventType = AgentRunEventType | AgentFileEventType;

export const AGENT_TOOL_NAMES = {
  LIST_FILES: "list_files",
  READ_FILE: "read_file",
  WRITE_FILE: "write_file",
  EDIT_FILE: "edit_file",
  DELETE_FILE: "delete_file",
  MAKE_DIRECTORY: "make_directory",
  MOVE_FILE: "move_file",
  EXECUTE_COMMAND: "execute_command",
  COMPUTER_USE: "computer_use",
  BROWSER_OPEN_URL: "browser_open_url",
} as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[keyof typeof AGENT_TOOL_NAMES];
