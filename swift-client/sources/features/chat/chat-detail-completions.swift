import Foundation

extension ChatDetailViewModel {
  func completeChat(api: ApiClient) async -> ChatCompletionResponse? {
    let model = sessionModel ?? messages.first(where: { $0.model != nil })?.model ?? "default"
    let openaiMessages = buildOpenAIMessages(from: messages)
    let toolDefs = settings?.mcpEnabled == true ? tools.map { toolDef(for: $0) } : nil
    let payload = ChatCompletionRequest(model: model, messages: openaiMessages, tools: toolDefs, stream: false, temperature: 0.7)
    return try? await api.chatCompletion(payload)
  }

  func handleResponse(_ response: ChatCompletionResponse, api: ApiClient, userContent: String) async {
    guard let message = response.choices.first?.message else { return }
    let assistant = StoredMessage(id: UUID().uuidString, role: "assistant", content: message.content, model: nil, toolCalls: message.toolCalls)
    messages.append(assistant)
    _ = try? await api.addMessage(sessionId: sessionId, message: assistant)

    if let toolCalls = message.toolCalls, !toolCalls.isEmpty {
      let results = await McpToolRunner(api: api).run(calls: toolCalls)
      for toolMessage in results {
        messages.append(toolMessage)
        _ = try? await api.addMessage(sessionId: sessionId, message: toolMessage)
      }
      if let final = await completeChat(api: api), let finalMessage = final.choices.first?.message {
        let finalStored = StoredMessage(id: UUID().uuidString, role: "assistant", content: finalMessage.content, model: nil, toolCalls: finalMessage.toolCalls)
        messages.append(finalStored)
        _ = try? await api.addMessage(sessionId: sessionId, message: finalStored)
        await updateTitle(user: userContent, assistant: finalMessage.content ?? "", api: api)
      }
    } else {
      await updateTitle(user: userContent, assistant: message.content ?? "", api: api)
    }
  }
}
