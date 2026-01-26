import Foundation

func buildOpenAIMessages(from messages: [StoredMessage]) -> [OpenAIMessage] {
  messages.map { msg in
    let content = msg.role == "assistant" ? ThinkingParser.stripThinkingBlocks(msg.content ?? "") : msg.content
    return OpenAIMessage(role: msg.role, content: content, toolCalls: msg.toolCalls, toolCallId: msg.toolCallId, name: msg.name)
  }
}
