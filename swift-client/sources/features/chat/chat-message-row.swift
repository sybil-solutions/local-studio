import SwiftUI

struct ChatMessageRow: View {
  let message: StoredMessage
  let isStreaming: Bool
  let meta: AgentMeta?
  let onShowActions: (AgentMeta) -> Void

  var body: some View {
    HStack(alignment: .top) {
      if message.role == "assistant" { Spacer() }
      VStack(alignment: .leading, spacing: 8) {
        Text(message.role.capitalized).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
        if isStreaming {
          Text(parsed.main).font(AppTheme.bodyFont).foregroundColor(AppTheme.foreground)
        } else {
          MarkdownText(content: parsed.main).font(AppTheme.bodyFont).foregroundColor(AppTheme.foreground)
        }
        if let meta, message.role == "assistant" {
          Button(action: { onShowActions(meta) }) {
            HStack(spacing: 6) {
              Image(systemName: "brain")
              Text(summary(for: meta))
              Image(systemName: "chevron.up")
            }
            .font(AppTheme.captionFont)
            .foregroundColor(AppTheme.muted)
          }
        }
      }
      .padding(12)
      .background(message.role == "assistant" ? AppTheme.accent : AppTheme.card)
      .cornerRadius(12)
      if message.role == "user" { Spacer() }
    }
  }

  private var parsed: ThinkingResult {
    ThinkingParser.parse(message.content ?? "")
  }

  private func summary(for meta: AgentMeta) -> String {
    var parts: [String] = []
    if !meta.thinkingBlocks.isEmpty { parts.append("Thinking") }
    if !meta.toolCalls.isEmpty { parts.append("\(meta.toolCalls.count) tools") }
    return parts.isEmpty ? "Actions" : parts.joined(separator: " • ")
  }
}
