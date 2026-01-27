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

  // MARK: - Non-streaming completion (reliable fallback)

  func nonStreamingChat(messages: [OpenAIMessage], model: String, tools: [ToolDefinition]?) async throws -> StreamResult {
    let payload = ChatCompletionRequest(
      model: model, messages: messages, tools: tools,
      stream: false, temperature: 0.7
    )
    let request = try buildRequest(payload)

    isStreaming = true
    streamStart = Date()
    streamingContent = ""
    streamingReasoning = ""
    streamingToolCalls = []
    defer { isStreaming = false }

    let (data, response) = try await URLSession.shared.data(for: request)
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      throw StreamError.httpError(http.statusCode, String(data: data, encoding: .utf8) ?? "Unknown error")
    }

    let completion = try ApiCodec.decoder.decode(ChatCompletionResponse.self, from: data)
    let msg = completion.choices.first?.message
    let content = msg?.content ?? ""
    streamingContent = content
    return StreamResult(
      content: content, reasoning: "",
      toolCalls: msg?.toolCalls ?? [],
      finishReason: nil, usage: completion.usage
    )
  }

  // MARK: - Streaming completion

  func streamChat(messages: [OpenAIMessage], model: String, tools: [ToolDefinition]?) async throws -> StreamResult {
    let payload = ChatCompletionRequest(
      model: model, messages: messages, tools: tools,
      stream: true, temperature: 0.7,
      streamOptions: StreamOptions(includeUsage: true)
    )
    let request = try buildRequest(payload)

    var accContent = ""
    var accReasoning = ""
    var toolBuffer: [Int: ToolBuffer] = [:]
    var finishReason: String?
    var latestUsage: CompletionUsage?
    var receivedReasoning = false
    var rawLines: [String] = []
    var decodedAnyChunk = false

    isStreaming = true
    streamStart = Date()
    streamingContent = ""
    streamingReasoning = ""
    streamingToolCalls = []
    streamingUsage = nil

    defer { isStreaming = false }

    let (bytes, response) = try await URLSession.shared.bytes(for: request)

    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      var errorBody = ""
      for try await line in bytes.lines { errorBody += line }
      throw StreamError.httpError(http.statusCode, errorBody)
    }

    var parser = SseParser()
    for try await line in bytes.lines {
      rawLines.append(line)
      let events = parser.ingest(line + "\n")
      for event in events {
        guard event.data != "[DONE]" else { continue }
        guard let data = event.data.data(using: .utf8) else { continue }
        guard let chunk = try? ApiCodec.decoder.decode(StreamChunk.self, from: data) else {
          continue
        }
        decodedAnyChunk = true

        if let usage = chunk.usage {
          latestUsage = usage
          streamingUsage = usage
        }
        guard let choices = chunk.choices else { continue }
        for choice in choices {
          guard let delta = choice.delta else { continue }

          if let text = delta.content, !text.isEmpty {
            accContent.append(text)
          }
          let dr = delta.reasoningContent ?? delta.reasoning
          if let reasoning = dr, !reasoning.isEmpty {
            receivedReasoning = true
            accReasoning.append(reasoning)
            streamingReasoning = accReasoning
          }

          // Update live streaming content
          if receivedReasoning {
            streamingContent = ThinkingParser.stripThinkingBlocks(accContent)
          } else {
            let parsed = ThinkingParser.parse(accContent)
            streamingContent = parsed.main
            streamingReasoning = parsed.thinking ?? ""
          }

          if let tools = delta.toolCalls {
            for tool in tools {
              let index = tool.index ?? 0
              var buf = toolBuffer[index] ?? ToolBuffer(id: tool.id, type: tool.type, name: "", arguments: "")
              if let name = tool.function?.name { buf.name = name }
              if let args = tool.function?.arguments { buf.arguments += args }
              if buf.id == nil { buf.id = tool.id }
              buf.type = buf.type ?? tool.type
              toolBuffer[index] = buf
            }
            streamingToolCalls = finalizeBuffers(toolBuffer)
          }
          if let reason = choice.finishReason { finishReason = reason }
        }
      }
    }

    // Fallback: if no SSE chunks decoded, try parsing as plain JSON response
    if !decodedAnyChunk {
      let raw = rawLines.joined(separator: "\n")
      if let data = raw.data(using: .utf8),
         let completion = try? ApiCodec.decoder.decode(ChatCompletionResponse.self, from: data),
         let msg = completion.choices.first?.message {
        let content = msg.content ?? ""
        return StreamResult(
          content: content, reasoning: "",
          toolCalls: msg.toolCalls ?? [],
          finishReason: nil, usage: completion.usage
        )
      }
    }

    let finalTools = finalizeBuffers(toolBuffer)
    var finalContent: String
    var finalReasoning: String
    if receivedReasoning {
      finalContent = ThinkingParser.stripThinkingBlocks(accContent)
      finalReasoning = accReasoning
    } else {
      let parsed = ThinkingParser.parse(accContent)
      finalContent = parsed.main
      finalReasoning = parsed.thinking ?? ""
    }

    // If content is empty but reasoning isn't, use reasoning as content
    if finalContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
       !finalReasoning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      finalContent = finalReasoning
      finalReasoning = ""
    }

    return StreamResult(
      content: finalContent, reasoning: finalReasoning,
      toolCalls: finalTools, finishReason: finishReason,
      usage: latestUsage
    )
  }

  // MARK: - Request building

  private func buildRequest(_ payload: ChatCompletionRequest) throws -> URLRequest {
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
    if payload.stream { request.setValue("text/event-stream", forHTTPHeaderField: "Accept") }
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
