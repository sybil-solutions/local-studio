// CRITICAL
import SwiftUI

struct ChatMessageMetaDropdown: View {
  let thinkingBlocks: [String]
  let toolCalls: [ToolCall]
  let toolResults: [String]
  let onShowActions: () -> Void
  @State private var isExpanded = false

  var body: some View {
    if thinkingBlocks.isEmpty && toolCalls.isEmpty && toolResults.isEmpty {
      EmptyView()
    } else {
      VStack(alignment: .leading, spacing: 8) {
        Button(action: { isExpanded.toggle() }) {
          HStack(spacing: 6) {
            Text(summary).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
            Spacer()
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
              .font(.system(size: 10))
              .foregroundColor(AppTheme.muted)
          }
        }

        if isExpanded {
          VStack(alignment: .leading, spacing: 10) {
            if !thinkingBlocks.isEmpty {
              sectionTitle("Thinking")
              ForEach(thinkingBlocks, id: \.self) { block in
                Text(block)
                  .font(AppTheme.monoFont)
                  .foregroundColor(AppTheme.foreground)
                  .padding(8)
                  .background(AppTheme.card)
                  .cornerRadius(8)
              }
            }

            if !toolCalls.isEmpty {
              sectionTitle("Tool calls")
              ForEach(toolCalls) { call in
                VStack(alignment: .leading, spacing: 4) {
                  Text(call.function.name)
                    .font(AppTheme.captionFont.weight(.semibold))
                    .foregroundColor(AppTheme.foreground)
                  Text(call.function.arguments)
                    .font(AppTheme.monoFont)
                    .foregroundColor(AppTheme.muted)
                }
                .padding(8)
                .background(AppTheme.card)
                .cornerRadius(8)
              }
            }

            if !toolResults.isEmpty {
              sectionTitle("Tool results")
              ForEach(Array(toolResults.enumerated()), id: \.offset) { _, result in
                Text(result)
                  .font(AppTheme.monoFont)
                  .foregroundColor(AppTheme.muted)
                  .padding(8)
                  .background(AppTheme.card)
                  .cornerRadius(8)
              }
            }

            Button(action: onShowActions) {
              HStack(spacing: 6) {
                Text("Open full log").font(AppTheme.captionFont)
                Image(systemName: "chevron.right")
                  .font(.system(size: 10, weight: .semibold))
              }
              .foregroundColor(AppTheme.muted)
            }
          }
        }
      }
    }
  }

  private var summary: String {
    var parts: [String] = []
    if !thinkingBlocks.isEmpty { parts.append("Thinking") }
    if !toolCalls.isEmpty { parts.append("\(toolCalls.count) tools") }
    if !toolResults.isEmpty { parts.append("Results") }
    return parts.isEmpty ? "Details" : parts.joined(separator: " • ")
  }

  private func sectionTitle(_ text: String) -> some View {
    Text(text).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
  }
}
