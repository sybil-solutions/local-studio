import SwiftUI

struct UsageModelRowView: View {
  let row: UsageModelRow

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(row.model).font(.headline)
      Text("Requests \(row.requests) | Tokens \(row.totalTokens)")
        .font(.caption).foregroundColor(AppTheme.muted)
    }
  }
}
