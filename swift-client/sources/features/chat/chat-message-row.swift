// CRITICAL
import SwiftUI

struct MessageActionHandlers {
  let onCopy: () -> Void
  let onContext: () -> Void
  let onFork: () -> Void
  let onRetry: () -> Void
}

struct ChatMessageRow: View {
  let message: StoredMessage
  let isStreaming: Bool
  let meta: AgentMeta?
  let onShowActions: (AgentMeta) -> Void
  let actions: MessageActionHandlers?

  @State private var selectedArtifact: Artifact?
  @State private var showMessageActions = false

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
      Spacer(minLength: 40)
      VStack(alignment: .trailing, spacing: 4) {
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
  }

  // MARK: - Assistant message

  private var assistantBlock: some View {
    HStack {
      VStack(alignment: .leading, spacing: 12) {
        // Assistant header
        HStack(spacing: 6) {
          Image(systemName: "sparkles")
            .font(.system(size: 12))
            .foregroundColor(AppTheme.accentStrong)
          Text("Assistant")
            .font(AppTheme.captionFont.weight(.medium))
            .foregroundColor(AppTheme.muted)
          Spacer()
        }

        // Message content
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

        // Meta dropdown for thinking/tools
        if let meta, !meta.thinkingBlocks.isEmpty || !meta.toolCalls.isEmpty || !meta.toolResults.isEmpty {
          ChatMessageMetaDropdown(
            thinkingBlocks: meta.thinkingBlocks,
            toolCalls: meta.toolCalls,
            toolResults: meta.toolResults,
            onShowActions: { onShowActions(meta) }
          )
        }

        if showMessageActions, let actions {
          MessageActionBar(content: actionContent, actions: actions)
            .transition(.opacity)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(Rectangle())
      .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 20, pressing: { pressing in
        guard canShowActions else { return }
        withAnimation(.easeInOut(duration: 0.15)) {
          showMessageActions = pressing
        }
      }, perform: {})
      Spacer(minLength: 40)
    }
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

  private var actionContent: String {
    if message.role == "assistant" {
      return artifactResult.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return (message.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var canShowActions: Bool {
    actions != nil && message.role == "assistant" && !isStreaming && !actionContent.isEmpty
  }
}

private struct MessageActionBar: View {
  let content: String
  let actions: MessageActionHandlers

  var body: some View {
    HStack(spacing: 12) {
      iconButton(systemImage: "doc.on.doc", action: actions.onCopy)
      iconButton(systemImage: "rectangle.and.text.magnifyingglass", action: actions.onContext)
      iconButton(systemImage: "arrow.branch", action: actions.onFork)
      iconButton(systemImage: "arrow.clockwise", action: actions.onRetry)
      ShareLink(item: content) {
        iconLabel(systemImage: "square.and.arrow.up")
      }
    }
    .padding(8)
    .background(AppTheme.card)
    .cornerRadius(12)
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(AppTheme.border, lineWidth: 1)
    )
  }

  private func iconButton(systemImage: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      iconLabel(systemImage: systemImage)
    }
    .buttonStyle(.plain)
  }

  private func iconLabel(systemImage: String) -> some View {
    Image(systemName: systemImage)
      .font(.system(size: 12, weight: .semibold))
      .foregroundColor(AppTheme.foreground)
      .frame(width: 28, height: 28)
      .background(AppTheme.background)
      .cornerRadius(10)
  }
}

extension ChatMessageRow: Equatable {
  static func == (lhs: ChatMessageRow, rhs: ChatMessageRow) -> Bool {
    lhs.message.id == rhs.message.id
      && lhs.message.content == rhs.message.content
      && lhs.isStreaming == rhs.isStreaming
  }
}
