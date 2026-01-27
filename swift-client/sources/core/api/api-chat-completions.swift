import Foundation

extension ApiClient {
  func chatCompletion(_ payload: ChatCompletionRequest) async throws -> ChatCompletionResponse {
    let data = try ApiCodec.encoder.encode(payload)
    return try await request("/v1/chat/completions", method: "POST", body: data)
  }

  func tokenizeChatCompletions(model: String, messages: [OpenAIMessage], tools: [ToolDefinition]?) async throws -> TokenizeChatResponse {
    let payload = TokenizeChatRequest(model: model, messages: messages, tools: tools)
    let data = try ApiCodec.encoder.encode(payload)
    return try await request("/v1/tokenize-chat-completions", method: "POST", body: data)
  }

  func generateTitle(model: String?, user: String, assistant: String) async throws -> TitleResponse {
    let payload = TitleRequest(model: model, user: user, assistant: assistant)
    let data = try ApiCodec.encoder.encode(payload)
    return try await request("/api/title", method: "POST", body: data)
  }
}
