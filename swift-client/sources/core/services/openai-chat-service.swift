// CRITICAL
import Foundation
import OpenAI

@MainActor
final class OpenAIChatService: ObservableObject {
  @Published var isStreaming = false
  @Published var streamStart: Date?
  @Published var streamingContent = ""
  @Published var streamingReasoning = ""
  @Published var streamingToolCalls: [ToolCall] = []

  private var apiKey = ""
  private var baseURL = ""

  func configure(apiKey: String, baseURL: String) {
    self.apiKey = apiKey
    self.baseURL = baseURL
  }

  struct StreamResult {
    let content: String
    let reasoning: String
    let toolCalls: [ToolCall]
    let finishReason: String?
  }

  func streamChat(messages: [OpenAIMessage], model: String, tools: [ToolDefinition]?) async throws -> StreamResult {
    let query = ChatQuery(
      messages: convertMessages(messages),
      model: model,
      tools: tools?.map { convertTool($0) },
      stream: true,
      streamOptions: .init(includeUsage: true)
    )

    var accumulatedContent = ""
    var accumulatedReasoning = ""
    var toolBuffer: [Int: ToolBuffer] = [:]
    var finishReason: String?

    isStreaming = true
    streamStart = Date()
    streamingContent = ""
    streamingReasoning = ""
    streamingToolCalls = []

    defer { isStreaming = false }

    for try await result in openAI.chatsStream(query: query) {
      for choice in result.choices {
        if let text = choice.delta.content, !text.isEmpty {
          accumulatedContent.append(text)
          streamingContent = accumulatedContent
        }

        if let reasoning = choice.delta.reasoning, !reasoning.isEmpty {
          accumulatedReasoning.append(reasoning)
          streamingReasoning = accumulatedReasoning
        }

        if let tools = choice.delta.toolCalls {
          for tool in tools {
            let index = tool.index ?? 0
            var buffer = toolBuffer[index] ?? ToolBuffer(id: tool.id, type: tool.type, name: "", arguments: "")
            if let name = tool.function?.name { buffer.name = name }
            if let args = tool.function?.arguments { buffer.arguments += args }
            if buffer.id == nil { buffer.id = tool.id }
            buffer.type = buffer.type ?? tool.type
            toolBuffer[index] = buffer
          }
          streamingToolCalls = finalizeBuffers(toolBuffer)
        }

        if let reason = choice.finishReason?.rawValue {
          finishReason = reason
        }
      }

      if finishReason != nil {
        break
      }
    }

    let finalTools = finalizeBuffers(toolBuffer)

    return StreamResult(
      content: accumulatedContent,
      reasoning: accumulatedReasoning,
      toolCalls: finalTools,
      finishReason: finishReason
    )
  }

  private var openAI: OpenAI {
    OpenAI(configuration: makeConfiguration())
  }

  private func makeConfiguration() -> OpenAI.Configuration {
    let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    let raw = trimmed.isEmpty ? "http://localhost:8080" : trimmed
    let normalized = raw.contains("://") ? raw : "http://\(raw)"
    let components = URLComponents(string: normalized)
    let scheme = components?.scheme ?? "http"
    let host = components?.host ?? raw
    let path = components?.path ?? ""
    let basePath = path.isEmpty || path == "/" ? "/v1" : path
    let port = components?.port ?? (scheme == "https" ? 443 : 80)
    let token = apiKey.isEmpty ? nil : apiKey
    return OpenAI.Configuration(
      token: token,
      host: host,
      port: port,
      scheme: scheme,
      basePath: basePath,
      timeoutInterval: 60,
      customHeaders: [:],
      parsingOptions: .relaxed
    )
  }

  private func convertMessages(_ messages: [OpenAIMessage]) -> [ChatQuery.ChatCompletionMessageParam] {
    messages.compactMap { msg in
      switch msg.role {
      case "system":
        guard let content = msg.content else { return nil }
        return .system(.init(content: .textContent(content), name: msg.name))
      case "developer":
        guard let content = msg.content else { return nil }
        return .developer(.init(content: .textContent(content), name: msg.name))
      case "user":
        guard let content = msg.content else { return nil }
        return .user(.init(content: .string(content), name: msg.name))
      case "assistant":
        let toolCalls = msg.toolCalls?.map { convertToolCall($0) }
        let assistantContent = msg.content.map { ChatQuery.ChatCompletionMessageParam.TextOrRefusalContent.textContent($0) }
        return .assistant(.init(content: assistantContent, name: msg.name, toolCalls: toolCalls))
      case "tool":
        guard let content = msg.content, let toolCallId = msg.toolCallId else { return nil }
        return .tool(.init(content: .textContent(content), toolCallId: toolCallId))
      default:
        guard let content = msg.content else { return nil }
        return .user(.init(content: .string(content), name: msg.name))
      }
    }
  }

  private func convertToolCall(_ call: ToolCall) -> ChatQuery.ChatCompletionMessageParam.AssistantMessageParam.ToolCallParam {
    .init(id: call.id, function: .init(arguments: call.function.arguments, name: call.function.name))
  }

  private func convertTool(_ tool: ToolDefinition) -> ChatQuery.ChatCompletionToolParam {
    .init(function: .init(
      name: tool.function.name,
      description: tool.function.description,
      parameters: convertSchema(tool.function.parameters)
    ))
  }

  private func convertSchema(_ parameters: AnyEncodable?) -> JSONSchema? {
    guard let parameters else { return nil }
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(parameters) else { return nil }
    return try? JSONDecoder().decode(JSONSchema.self, from: data)
  }

  private func finalizeBuffers(_ buffers: [Int: ToolBuffer]) -> [ToolCall] {
    buffers.keys.sorted().compactMap { index in
      guard let buffer = buffers[index], !buffer.name.isEmpty else { return nil }
      return ToolCall(
        id: buffer.id ?? UUID().uuidString,
        type: buffer.type ?? "function",
        function: ToolFunction(name: buffer.name, arguments: buffer.arguments)
      )
    }
  }
}

private struct ToolBuffer {
  var id: String?
  var type: String?
  var name: String
  var arguments: String
}
