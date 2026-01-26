import Foundation

struct AgentMeta {
  var thinkingBlocks: [String]
  var toolCalls: [ToolCall]
  var toolResults: [String]
}

struct ChatAgentActions: Identifiable {
  let id: String
  let title: String
  let meta: AgentMeta
  let startedAt: Date?
  let isStreaming: Bool
}
