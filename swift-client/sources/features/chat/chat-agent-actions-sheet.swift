import SwiftUI

struct ChatAgentActionsSheet: View {
  let actions: ChatAgentActions

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Text(actions.title).font(AppTheme.sectionFont)
        if !actions.meta.thinkingBlocks.isEmpty {
          sectionTitle("Thinking")
          ForEach(actions.meta.thinkingBlocks, id: \.self) { block in
            Text(block).font(AppTheme.monoFont)
              .foregroundColor(AppTheme.foreground)
              .padding(8)
              .background(AppTheme.card)
              .cornerRadius(8)
          }
        }
        if !actions.meta.toolCalls.isEmpty {
          sectionTitle("Tools")
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
            ForEach(actions.meta.toolCalls) { call in
              chip(call.function.name, icon: "wrench")
            }
          }
        }
        if !actions.meta.toolResults.isEmpty {
          sectionTitle("Results")
          ForEach(actions.meta.toolResults, id: \.self) { result in
            Text(result).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
          }
        }
      }
      .padding(16)
    }
    .background(AppTheme.background)
  }

  private func sectionTitle(_ text: String) -> some View {
    Text(text).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
  }

  private func chip(_ label: String, icon: String) -> some View {
    HStack(spacing: 6) {
      Image(systemName: icon).font(.system(size: 10))
      Text(label).font(AppTheme.captionFont)
    }
    .foregroundColor(AppTheme.muted)
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    .background(AppTheme.background)
    .cornerRadius(999)
    .overlay(RoundedRectangle(cornerRadius: 999).stroke(AppTheme.border, lineWidth: 1))
  }
}
