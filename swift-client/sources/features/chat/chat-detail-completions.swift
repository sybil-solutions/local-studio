// CRITICAL
import Foundation

extension ChatDetailViewModel {
  func makeCompletionPayload(stream: Bool) -> ChatCompletionRequest {
    let model = sessionModel ?? messages.first(where: { $0.model != nil })?.model ?? "default"
    let openaiMessages = buildPromptMessages()
    let toolDefs = settings?.mcpEnabled == true ? tools.map { toolDef(for: $0) } : nil
    return ChatCompletionRequest(model: model, messages: openaiMessages, tools: toolDefs, stream: stream, temperature: 0.7)
  }

  func buildPromptMessages() -> [OpenAIMessage] {
    var promptMessages: [OpenAIMessage] = []
    if let prompt = combinedPrompt {
      promptMessages.append(OpenAIMessage(role: "system", content: prompt, toolCalls: nil, toolCallId: nil, name: nil))
    }
    promptMessages.append(contentsOf: buildOpenAIMessages(from: messages))
    return promptMessages
  }

  private var combinedPrompt: String? {
    let base = systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
    let research = deepResearchEnabled ? "\n\nUse web search tools before responding." : ""
    let combined = base + research
    return combined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : combined
  }
}
