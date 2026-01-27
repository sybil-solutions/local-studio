import SwiftUI

struct ChatStreamingMessageView: View {
  @ObservedObject var service: OpenAIChatService
  let scrollProxy: ScrollViewProxy
  let onShowActions: (AgentMeta) -> Void

  var body: some View {
    let message = StoredMessage(
      id: "streaming",
      role: "assistant",
      content: service.streamingContent,
      model: nil,
      toolCalls: nil
    )
    let meta = AgentMeta(
      thinkingBlocks: service.streamingReasoning.isEmpty ? [] : [service.streamingReasoning],
      toolCalls: service.streamingToolCalls,
      toolResults: []
    )
    ChatMessageRow(
      message: message,
      isStreaming: true,
      meta: meta,
      onShowActions: { onShowActions($0) }
    )
    .id("streaming")
    .onChange(of: service.streamingContent) { _, _ in
      scrollProxy.scrollTo("streaming", anchor: .bottom)
    }
  }
}
