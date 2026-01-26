import SwiftUI

struct UsageMetricCard: View {
  let title: String
  let value: String
  let subtitle: String

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 6) {
        Text(title).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
        Text(value).font(AppTheme.sectionFont)
        Text(subtitle).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
      }
    }
  }
}
