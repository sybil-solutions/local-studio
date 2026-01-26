import SwiftUI

struct ChatMessageMetaDropdown: View {
  let thinking: String?
  let toolCalls: [ToolCall]
  let tokenCount: Int?
  @State private var isExpanded = false

  var body: some View {
    if thinking == nil && toolCalls.isEmpty { EmptyView() } else {
      VStack(alignment: .leading, spacing: 6) {
        Button(action: { isExpanded.toggle() }) {
          HStack(spacing: 6) {
            Text(summary).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
            Spacer()
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
              .font(.system(size: 10)).foregroundColor(AppTheme.muted)
          }
        }
        if isExpanded {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 6)], spacing: 6) {
            if let seconds = thoughtSeconds {
              chip("Thought • \(seconds)s", icon: "brain")
            }
            ForEach(toolCalls) { call in
              chip(call.function.name, icon: "wrench")
            }
          }
        }
      }
    }
  }

  private var summary: String {
    var parts: [String] = []
    if thinking != nil { parts.append("Thought") }
    if !toolCalls.isEmpty { parts.append("\(toolCalls.count) tools") }
    return parts.isEmpty ? "Details" : parts.joined(separator: " • ")
  }

  private var thoughtSeconds: Int? {
    guard thinking != nil else { return nil }
    let base = Double(tokenCount ?? max(1, (thinking?.count ?? 0) / 4))
    return max(1, Int(ceil(base / 25)))
  }

  @ViewBuilder
  private func chip(_ label: String, icon: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: icon).font(.system(size: 10))
      Text(label).font(AppTheme.captionFont)
    }
    .foregroundColor(AppTheme.muted)
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(AppTheme.background)
    .cornerRadius(999)
    .overlay(RoundedRectangle(cornerRadius: 999).stroke(AppTheme.border, lineWidth: 1))
  }
}
