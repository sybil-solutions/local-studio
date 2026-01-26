import SwiftUI

struct ThinkingBlock: View {
  let content: String
  @State private var isExpanded = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Button(action: { isExpanded.toggle() }) {
        HStack {
          Text(isExpanded ? "Hide thinking" : "Show thinking")
          Spacer()
          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
        }
      }
      .font(AppTheme.captionFont)
      .foregroundColor(AppTheme.muted)
      if isExpanded {
        Text(content)
          .font(AppTheme.monoFont)
          .foregroundColor(AppTheme.foreground)
          .padding(8)
          .background(AppTheme.background)
          .cornerRadius(8)
      }
    }
  }
}
