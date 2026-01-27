import Foundation

struct StoredMessage: Codable, Identifiable {
  let id: String
  let role: String
  let content: String?
  let model: String?
  let toolCalls: [ToolCall]?
  let toolCallId: String?
  let name: String?
  let requestPromptTokens: Int?
  let requestToolsTokens: Int?
  let requestTotalInputTokens: Int?
  let requestCompletionTokens: Int?
  let createdAt: String?

  init(id: String, role: String, content: String?, model: String?, toolCalls: [ToolCall]?, toolCallId: String? = nil, promptTokens: Int? = nil, toolsTokens: Int? = nil, totalInputTokens: Int? = nil, completionTokens: Int? = nil) {
    self.id = id
    self.role = role
    self.content = content
    self.model = model
    self.toolCalls = toolCalls
    self.toolCallId = toolCallId
    name = nil
    requestPromptTokens = promptTokens
    requestToolsTokens = toolsTokens
    let computedTotal = totalInputTokens ?? {
      if let promptTokens, let toolsTokens { return promptTokens + toolsTokens }
      if let promptTokens { return promptTokens }
      if let toolsTokens { return toolsTokens }
      return nil
    }()
    requestTotalInputTokens = computedTotal
    requestCompletionTokens = completionTokens
    createdAt = nil
  }
}

struct ToolCall: Codable, Identifiable {
  let id: String
  let type: String
  let function: ToolFunction
}

struct ToolFunction: Codable {
  let name: String
  let arguments: String
}

struct ChatUsage: Codable {
  let promptTokens: Int
  let completionTokens: Int
  let totalTokens: Int
}
