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
        HStack(spacing: 8) {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              if !thinkingBlocks.isEmpty { metaChip("Thinking", icon: "brain") }
              if !toolCalls.isEmpty { metaChip("\(toolCalls.count) tools", icon: "wrench.and.screwdriver") }
              if !toolResults.isEmpty { metaChip("Results", icon: "checkmark.circle") }
            }
          }
          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
            .font(.system(size: 10))
            .foregroundColor(AppTheme.muted)
        }
        .contentShape(Rectangle())
        .onTapGesture { isExpanded.toggle() }

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

  private func sectionTitle(_ text: String) -> some View {
    Text(text).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
  }

  private func metaChip(_ text: String, icon: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon).font(.system(size: 10))
      Text(text).font(AppTheme.captionFont)
    }
    .foregroundColor(AppTheme.muted)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(AppTheme.background)
    .cornerRadius(999)
    .overlay(RoundedRectangle(cornerRadius: 999).stroke(AppTheme.border, lineWidth: 1))
  }
}
