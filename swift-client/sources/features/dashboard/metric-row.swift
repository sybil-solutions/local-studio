import SwiftUI

struct MetricRow: View {
  let label: String
  let value: String

  var body: some View {
    HStack {
      Text(label).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
      Spacer()
      Text(value).font(AppTheme.monoFont).foregroundColor(AppTheme.foreground)
    }
  }
}
