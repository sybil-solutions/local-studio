import SwiftUI

struct UsageMetricCard: View {
  let title: String
  let value: String
  let subtitle: String

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 6) {
        Text(title).font(.caption).foregroundColor(AppTheme.muted)
        Text(value).font(AppTheme.titleFont)
        Text(subtitle).font(.caption).foregroundColor(AppTheme.muted)
      }
    }
  }
}
