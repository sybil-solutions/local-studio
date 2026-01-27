// CRITICAL
import SwiftUI

struct ChatStreamingMessageView: View {
  @ObservedObject var service: OpenAIChatService
  let scrollProxy: ScrollViewProxy
  let onShowActions: (AgentMeta) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      // Streaming content
      if !service.streamingContent.isEmpty {
        MarkdownText(content: service.streamingContent)
          .foregroundColor(AppTheme.foreground)
      }
      
      // Live thinking/tracing indicator
      if !service.streamingReasoning.isEmpty || !service.streamingToolCalls.isEmpty {
        StreamingMetaIndicator(
          reasoning: service.streamingReasoning,
          toolCalls: service.streamingToolCalls
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .id("streaming")
    .onChange(of: service.streamingContent) { _, _ in
      scrollProxy.scrollTo("streaming", anchor: .bottom)
    }
    .onChange(of: service.streamingReasoning) { _, _ in
      scrollProxy.scrollTo("streaming", anchor: .bottom)
    }
  }
}

private struct StreamingMetaIndicator: View {
  let reasoning: String
  let toolCalls: [ToolCall]
  
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !reasoning.isEmpty {
        HStack(spacing: 6) {
          Image(systemName: "brain")
            .font(.system(size: 10))
            .foregroundColor(AppTheme.accentStrong)
          Text("Reasoning...")
            .font(AppTheme.captionFont)
            .foregroundColor(AppTheme.accentStrong)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(AppTheme.accent.opacity(0.15))
        .cornerRadius(8)
      }
      
      if !toolCalls.isEmpty {
        HStack(spacing: 6) {
          Image(systemName: "wrench.and.screwdriver")
            .font(.system(size: 10))
            .foregroundColor(AppTheme.warning)
          Text("Using \(toolCalls.count) tool\(toolCalls.count == 1 ? "" : "s")...")
            .font(AppTheme.captionFont)
            .foregroundColor(AppTheme.warning)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(AppTheme.warning.opacity(0.15))
        .cornerRadius(8)
      }
    }
  }
}
