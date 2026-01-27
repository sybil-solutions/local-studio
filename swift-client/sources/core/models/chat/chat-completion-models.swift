// CRITICAL
import Foundation

struct ChatCompletionRequest: Encodable {
  let model: String
  let messages: [OpenAIMessage]
  let tools: [ToolDefinition]?
  let stream: Bool
  let temperature: Double
  let streamOptions: StreamOptions?

  init(model: String, messages: [OpenAIMessage], tools: [ToolDefinition]?, stream: Bool, temperature: Double, streamOptions: StreamOptions? = nil) {
    self.model = model
    self.messages = messages
    self.tools = tools
    self.stream = stream
    self.temperature = temperature
    self.streamOptions = streamOptions
  }
}

struct StreamOptions: Encodable {
  let includeUsage: Bool
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

// MARK: - Tokenization

struct TokenizeChatRequest: Encodable {
  let model: String
  let messages: [OpenAIMessage]
  let tools: [ToolDefinition]?
}

struct TokenizeChatBreakdown: Decodable {
  let messages: Int?
  let tools: Int?
}

struct TokenizeChatResponse: Decodable {
  let inputTokens: Int?
  let breakdown: TokenizeChatBreakdown?
  let model: String?
}

// MARK: - Streaming chunk models

struct StreamChunk: Decodable {
  let id: String?
  let choices: [StreamChoice]?
  let usage: CompletionUsage?
}

struct StreamChoice: Decodable {
  let index: Int?
  let delta: StreamDelta?
  let finishReason: String?
}

struct StreamDelta: Decodable {
  let role: String?
  let content: String?
  let reasoningContent: String?
  let reasoning: String?
  let toolCalls: [StreamToolCall]?
}

struct StreamToolCall: Decodable {
  let index: Int?
  let id: String?
  let type: String?
  let function: StreamToolFunction?
}

struct StreamToolFunction: Decodable {
  let name: String?
  let arguments: String?
}
