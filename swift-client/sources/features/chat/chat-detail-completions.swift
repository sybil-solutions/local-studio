// CRITICAL
import Foundation

extension ChatDetailViewModel {
  func makeCompletionPayload(stream: Bool) -> ChatCompletionRequest {
    let model = sessionModel ?? messages.first(where: { $0.model != nil })?.model ?? "default"
    let openaiMessages = buildPromptMessages()
    var toolDefs: [ToolDefinition] = []
    if settings?.mcpEnabled == true { toolDefs.append(contentsOf: tools.map { toolDef(for: $0) }) }
    if settings?.planModeEnabled == true { toolDefs.append(contentsOf: PlanTools.definitions) }
    return ChatCompletionRequest(model: model, messages: openaiMessages, tools: toolDefs.isEmpty ? nil : toolDefs, stream: stream, temperature: 0.7)
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
    let plan = PlanToolHandler.promptSection(currentPlan) ?? ""
    let combined = base + research + plan
    return combined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : combined
  }
}
