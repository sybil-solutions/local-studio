// CRITICAL
import SwiftUI

struct ChatMessageRow: View {
  let message: StoredMessage
  let isStreaming: Bool
  let meta: AgentMeta?
  let onShowActions: (AgentMeta) -> Void

  @State private var selectedArtifact: Artifact?

  private var isUser: Bool { message.role == "user" }

  var body: some View {
    if isUser {
      userBubble
    } else {
      assistantBlock
    }
  }

  // MARK: - User message: right-aligned bubble

  private var userBubble: some View {
    HStack {
      Spacer(minLength: 60)
      Text(message.content ?? "")
        .font(AppTheme.bodyFont)
        .foregroundColor(AppTheme.foreground)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(AppTheme.accent.opacity(0.25))
        .cornerRadius(18)
        .overlay(
          RoundedRectangle(cornerRadius: 18)
            .stroke(AppTheme.accent.opacity(0.4), lineWidth: 1)
        )
    }
  }

  // MARK: - Assistant message: full-width, no bubble

  private var assistantBlock: some View {
    VStack(alignment: .leading, spacing: 10) {
      // Message text
      if isStreaming {
        MarkdownText(content: parsed.main)
          .foregroundColor(AppTheme.foreground)
      } else {
        MarkdownText(content: artifactResult.text)
          .foregroundColor(AppTheme.foreground)

        // Artifact cards
        if !artifactResult.artifacts.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
              ForEach(artifactResult.artifacts) { artifact in
                ArtifactCard(artifact: artifact) { selectedArtifact = artifact }
              }
            }
          }
        }
      }

      if let meta, !meta.thinkingBlocks.isEmpty || !meta.toolCalls.isEmpty || !meta.toolResults.isEmpty {
        ChatMessageMetaDropdown(
          thinkingBlocks: meta.thinkingBlocks,
          toolCalls: meta.toolCalls,
          toolResults: meta.toolResults,
          onShowActions: { onShowActions(meta) }
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .sheet(item: $selectedArtifact) { artifact in
      ArtifactViewerSheet(artifact: artifact)
    }
  }

  private var parsed: ThinkingResult {
    ThinkingParser.parse(message.content ?? "")
  }

  private var artifactResult: ArtifactParseResult {
    guard message.role == "assistant" else {
      return ArtifactParseResult(text: parsed.main, artifacts: [])
    }
    return ArtifactParser.parse(parsed.main)
  }

}

extension ChatMessageRow: Equatable {
  static func == (lhs: ChatMessageRow, rhs: ChatMessageRow) -> Bool {
    lhs.message.id == rhs.message.id
      && lhs.message.content == rhs.message.content
      && lhs.isStreaming == rhs.isStreaming
  }
}
