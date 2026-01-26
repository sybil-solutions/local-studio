// CRITICAL
import Foundation

extension ChatDetailViewModel {
  func streamTurn(api: ApiClient, userContent: String) async {
    openAIService.configure(
      apiKey: settings?.apiKey ?? "",
      baseURL: settings?.backendUrl ?? "http://localhost:8080"
    )
    let messages = buildPromptMessages()
    let toolDefs = settings?.mcpEnabled == true ? tools.map { toolDef(for: $0) } : nil
    let model = sessionModel ?? "default"

    guard let result = try? await openAIService.streamChat(
      messages: messages,
      model: model,
      tools: toolDefs
    ) else { return }

    let content = wrapThinking(result.reasoning, content: result.content)
    let assistantId = UUID().uuidString
    let assistant = StoredMessage(
      id: assistantId,
      role: "assistant",
      content: content,
      model: nil,
      toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls
    )
    self.messages.append(assistant)
    _ = try? await api.addMessage(sessionId: sessionId, message: assistant)
    agentMeta[assistantId] = AgentMeta(
      thinkingBlocks: thinkingBlocks(from: result.reasoning),
      toolCalls: result.toolCalls,
      toolResults: []
    )

    if !result.toolCalls.isEmpty {
      let results = await McpToolRunner(api: api).run(calls: result.toolCalls)
      for toolMessage in results {
        self.messages.append(toolMessage)
        _ = try? await api.addMessage(sessionId: sessionId, message: toolMessage)
      }
      if var meta = agentMeta[assistantId] {
        meta.toolResults.append(contentsOf: results.compactMap { $0.content })
        agentMeta[assistantId] = meta
      }

      guard let final = try? await openAIService.streamChat(
        messages: buildPromptMessages(),
        model: model,
        tools: nil
      ) else { return }

      let finalContent = wrapThinking(final.reasoning, content: final.content)
      let finalMsg = StoredMessage(
        id: UUID().uuidString,
        role: "assistant",
        content: finalContent,
        model: nil,
        toolCalls: final.toolCalls.isEmpty ? nil : final.toolCalls
      )
      self.messages.append(finalMsg)
      _ = try? await api.addMessage(sessionId: sessionId, message: finalMsg)
      agentMeta[finalMsg.id] = AgentMeta(
        thinkingBlocks: thinkingBlocks(from: final.reasoning),
        toolCalls: final.toolCalls,
        toolResults: []
      )
      await updateTitle(user: userContent, assistant: final.content, api: api)
    } else {
      await updateTitle(user: userContent, assistant: result.content, api: api)
    }
  }

  private func thinkingBlocks(from thinking: String) -> [String] {
    thinking.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : [thinking]
  }

  private func wrapThinking(_ thinking: String, content: String) -> String {
    let trimmed = thinking.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? content : "<think>\(trimmed)</think>\n\(content)"
  }
}
