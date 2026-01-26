import SwiftUI

struct UsageModelRowView: View {
  let row: UsageModelRow

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(row.model).font(AppTheme.sectionFont)
      Text("Requests \(row.requests) | Tokens \(row.totalTokens)")
        .font(AppTheme.captionFont)
        .foregroundColor(AppTheme.muted)
    }
  }
}
