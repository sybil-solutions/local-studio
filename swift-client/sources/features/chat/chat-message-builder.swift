import Foundation

func buildOpenAIMessages(from messages: [StoredMessage]) -> [OpenAIMessage] {
  messages.map { msg in
    OpenAIMessage(role: msg.role, content: msg.content, toolCalls: msg.toolCalls, toolCallId: msg.toolCallId, name: msg.name)
  }
}
