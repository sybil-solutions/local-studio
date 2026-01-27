// CRITICAL
import SwiftUI

struct ChatStreamingMessageView: View {
  @ObservedObject var service: OpenAIChatService
  let scrollProxy: ScrollViewProxy
  let onShowActions: (AgentMeta) -> Void
  @State private var showReasoning = false

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 10) {
        // Header
        HStack(spacing: 6) {
          Image(systemName: "sparkles")
            .font(.system(size: 12))
            .foregroundColor(AppTheme.accentStrong)
          Text("Assistant")
            .font(AppTheme.captionFont.weight(.medium))
            .foregroundColor(AppTheme.muted)
          Spacer()
        }

        // Live reasoning block (ChatGPT-style collapsible)
        if !service.streamingReasoning.isEmpty {
          VStack(alignment: .leading, spacing: 6) {
            Button(action: { withAnimation { showReasoning.toggle() } }) {
              HStack(spacing: 6) {
                Image(systemName: "brain")
                  .font(.system(size: 11))
                Text(showReasoning ? "Reasoning" : "Reasoning...")
                  .font(AppTheme.captionFont.weight(.medium))
                Spacer()
                Image(systemName: showReasoning ? "chevron.up" : "chevron.down")
                  .font(.system(size: 10))
              }
              .foregroundColor(AppTheme.accentStrong)
            }
            .buttonStyle(.plain)

            if showReasoning {
              Text(service.streamingReasoning)
                .font(AppTheme.monoFont)
                .foregroundColor(AppTheme.muted)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppTheme.accent.opacity(0.1))
                .cornerRadius(8)
            }
          }
          .padding(10)
          .background(AppTheme.accent.opacity(0.08))
          .cornerRadius(10)
          .overlay(
            RoundedRectangle(cornerRadius: 10)
              .stroke(AppTheme.accent.opacity(0.2), lineWidth: 1)
          )
        }

        // Streamed content
        if !service.streamingContent.isEmpty {
          MarkdownText(content: service.streamingContent)
            .foregroundColor(AppTheme.foreground)
        } else if service.streamingReasoning.isEmpty {
          // No content yet, no reasoning — show spinner
          HStack(spacing: 8) {
            ProgressView()
              .scaleEffect(0.8)
            Text("Thinking...")
              .font(AppTheme.bodyFont)
              .foregroundColor(AppTheme.muted)
          }
          .padding(.vertical, 4)
        }

        // Tool call badges
        if !service.streamingToolCalls.isEmpty {
          HStack(spacing: 6) {
            Image(systemName: "wrench.and.screwdriver")
              .font(.system(size: 10))
            Text("Using \(service.streamingToolCalls.count) tool\(service.streamingToolCalls.count == 1 ? "" : "s")...")
              .font(AppTheme.captionFont)
          }
          .foregroundColor(AppTheme.warning)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(AppTheme.warning.opacity(0.12))
          .cornerRadius(8)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .id("streaming")
    .onChange(of: service.streamingContent) { _, _ in
      scrollProxy.scrollTo("streaming", anchor: .bottom)
    }
    .onChange(of: service.streamingReasoning) { _, _ in
      scrollProxy.scrollTo("streaming", anchor: .bottom)
    }
  }
}
