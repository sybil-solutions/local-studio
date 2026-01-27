// CRITICAL
import Foundation

@MainActor
final class OpenAIChatService: ObservableObject {
  @Published var isStreaming = false
  @Published var streamStart: Date?
  @Published var streamingContent = ""
  @Published var streamingReasoning = ""
  @Published var streamingToolCalls: [ToolCall] = []
  @Published var streamingUsage: CompletionUsage?

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
    let usage: CompletionUsage?
  }

  func streamChat(messages: [OpenAIMessage], model: String, tools: [ToolDefinition]?) async throws -> StreamResult {
    let payload = ChatCompletionRequest(
      model: model,
      messages: messages,
      tools: tools,
      stream: true,
      temperature: 0.7,
      streamOptions: StreamOptions(includeUsage: true)
    )

    let request = try buildStreamRequest(payload)

    var accumulatedContent = ""
    var accumulatedReasoning = ""
    var parsedContent = ""
    var parsedReasoning = ""
    var toolBuffer: [Int: ToolBuffer] = [:]
    var finishReason: String?
    var latestUsage: CompletionUsage?
    var receivedReasoning = false

    isStreaming = true
    streamStart = Date()
    streamingContent = ""
    streamingReasoning = ""
    streamingToolCalls = []
    streamingUsage = nil

    defer { isStreaming = false }

    let (bytes, response) = try await URLSession.shared.bytes(for: request)

    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      // Read error body
      var errorBody = ""
      for try await line in bytes.lines {
        errorBody += line
      }
      throw StreamError.httpError(http.statusCode, errorBody)
    }

    var parser = SseParser()
    for try await line in bytes.lines {
      let events = parser.ingest(line + "\n")
      for event in events {
        guard event.data != "[DONE]" else { continue }
        guard let data = event.data.data(using: .utf8) else { continue }
        guard let chunk = try? ApiCodec.decoder.decode(StreamChunk.self, from: data) else { continue }

        if let usage = chunk.usage {
          latestUsage = usage
          streamingUsage = usage
        }

        guard let choices = chunk.choices else { continue }
        for choice in choices {
          guard let delta = choice.delta else { continue }

          if let text = delta.content, !text.isEmpty {
            accumulatedContent.append(text)
          }

          let deltaReasoning = delta.reasoningContent ?? delta.reasoning
          if let reasoning = deltaReasoning, !reasoning.isEmpty {
            receivedReasoning = true
            accumulatedReasoning.append(reasoning)
            streamingReasoning = accumulatedReasoning
          }

          if receivedReasoning {
            streamingContent = ThinkingParser.stripThinkingBlocks(accumulatedContent)
          } else {
            let parsed = ThinkingParser.parse(accumulatedContent)
            parsedContent = parsed.main
            parsedReasoning = parsed.thinking ?? ""
            streamingContent = parsedContent
            streamingReasoning = parsedReasoning
          }

          if let tools = delta.toolCalls {
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

          if let reason = choice.finishReason {
            finishReason = reason
          }
        }
      }
    }

    let finalTools = finalizeBuffers(toolBuffer)
    let finalContent: String
    let finalReasoning: String
    if receivedReasoning {
      finalContent = ThinkingParser.stripThinkingBlocks(accumulatedContent)
      finalReasoning = accumulatedReasoning
    } else {
      let parsed = ThinkingParser.parse(accumulatedContent)
      finalContent = parsed.main
      finalReasoning = parsed.thinking ?? ""
    }

    return StreamResult(
      content: finalContent,
      reasoning: finalReasoning,
      toolCalls: finalTools,
      finishReason: finishReason,
      usage: latestUsage
    )
  }

  private func buildStreamRequest(_ payload: ChatCompletionRequest) throws -> URLRequest {
    let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    let base = trimmed.isEmpty ? "http://localhost:8080" : trimmed
    let normalized = base.hasSuffix("/") ? String(base.dropLast()) : base
    guard let url = URL(string: "\(normalized)/v1/chat/completions") else {
      throw StreamError.invalidURL
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = try ApiCodec.encoder.encode(payload)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.timeoutInterval = 300
    if !apiKey.isEmpty {
      request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    }
    return request
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

enum StreamError: LocalizedError {
  case invalidURL
  case httpError(Int, String)

  var errorDescription: String? {
    switch self {
    case .invalidURL: return "Invalid backend URL"
    case .httpError(let code, let body): return "HTTP \(code): \(body.prefix(200))"
    }
  }
}
