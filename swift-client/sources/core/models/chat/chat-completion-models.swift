import Foundation

struct ChatCompletionRequest: Encodable {
  let model: String
  let messages: [OpenAIMessage]
  let tools: [ToolDefinition]?
  let stream: Bool
  let temperature: Double
}

struct OpenAIMessage: Codable {
  let role: String
  let content: String?
  let toolCalls: [ToolCall]?
  let toolCallId: String?
  let name: String?
}

struct ToolDefinition: Encodable {
  let type: String
  let function: ToolSpec
}

struct ToolSpec: Encodable {
  let name: String
  let description: String?
  let parameters: AnyEncodable?
}

struct ChatCompletionResponse: Decodable {
  let choices: [ChatChoice]
  let usage: CompletionUsage?
}

struct ChatChoice: Decodable {
  let message: OpenAIMessage
}

struct CompletionUsage: Decodable {
  let promptTokens: Int?
  let completionTokens: Int?
  let totalTokens: Int?
}
