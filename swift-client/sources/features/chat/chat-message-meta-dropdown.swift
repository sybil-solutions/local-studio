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
      VStack(alignment: .leading, spacing: 12) {
        // Collapsed/Expandable header with chips
        HStack(spacing: 8) {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
              if !thinkingBlocks.isEmpty { 
                metaChip("Thinking", icon: "brain", color: AppTheme.accentStrong) 
              }
              if !toolCalls.isEmpty { 
                metaChip("\(toolCalls.count) tool\(toolCalls.count == 1 ? "" : "s")", icon: "wrench.and.screwdriver", color: AppTheme.warning) 
              }
              if !toolResults.isEmpty { 
                metaChip("Results", icon: "checkmark.circle", color: AppTheme.success) 
              }
            }
          }
          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(AppTheme.muted)
        }
        .contentShape(Rectangle())
        .onTapGesture { isExpanded.toggle() }

        if isExpanded {
          VStack(alignment: .leading, spacing: 14) {
            if !thinkingBlocks.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Reasoning Process", icon: "brain")
                ForEach(thinkingBlocks, id: \.self) { block in
                  Text(block)
                    .font(AppTheme.monoFont)
                    .foregroundColor(AppTheme.foreground.opacity(0.9))
                    .padding(12)
                    .background(AppTheme.accent.opacity(0.15))
                    .cornerRadius(10)
                    .overlay(
                      RoundedRectangle(cornerRadius: 10)
                        .stroke(AppTheme.accent.opacity(0.3), lineWidth: 1)
                    )
                }
              }
            }

            if !toolCalls.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Tool Calls", icon: "wrench.and.screwdriver")
                ForEach(toolCalls) { call in
                  VStack(alignment: .leading, spacing: 6) {
                    HStack {
                      Image(systemName: "function")
                        .font(.system(size: 10))
                        .foregroundColor(AppTheme.warning)
                      Text(call.function.name)
                        .font(AppTheme.captionFont.weight(.semibold))
                        .foregroundColor(AppTheme.foreground)
                    }
                    Text(call.function.arguments)
                      .font(AppTheme.monoFont)
                      .foregroundColor(AppTheme.muted)
                      .lineLimit(3)
                  }
                  .padding(12)
                  .background(AppTheme.warning.opacity(0.1))
                  .cornerRadius(10)
                  .overlay(
                    RoundedRectangle(cornerRadius: 10)
                      .stroke(AppTheme.warning.opacity(0.3), lineWidth: 1)
                  )
                }
              }
            }

            if !toolResults.isEmpty {
              VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Tool Results", icon: "checkmark.circle")
                ForEach(Array(toolResults.enumerated()), id: \.offset) { _, result in
                  Text(result)
                    .font(AppTheme.monoFont)
                    .foregroundColor(AppTheme.muted)
                    .padding(12)
                    .background(AppTheme.success.opacity(0.1))
                    .cornerRadius(10)
                    .overlay(
                      RoundedRectangle(cornerRadius: 10)
                        .stroke(AppTheme.success.opacity(0.3), lineWidth: 1)
                    )
                }
              }
            }

            Button(action: onShowActions) {
              HStack(spacing: 6) {
                Text("View full log").font(AppTheme.captionFont.weight(.medium))
                Image(systemName: "arrow.right")
                  .font(.system(size: 10, weight: .semibold))
              }
              .foregroundColor(AppTheme.accentStrong)
              .padding(.top, 4)
            }
          }
        }
      }
    }
  }

  private func sectionTitle(_ text: String, icon: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon)
        .font(.system(size: 10))
      Text(text)
        .font(AppTheme.captionFont.weight(.semibold))
    }
    .foregroundColor(AppTheme.muted)
  }

  private func metaChip(_ text: String, icon: String, color: Color) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon)
        .font(.system(size: 10, weight: .semibold))
      Text(text)
        .font(AppTheme.captionFont.weight(.medium))
    }
    .foregroundColor(color)
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .background(color.opacity(0.12))
    .cornerRadius(999)
    .overlay(RoundedRectangle(cornerRadius: 999).stroke(color.opacity(0.3), lineWidth: 1))
  }
}
