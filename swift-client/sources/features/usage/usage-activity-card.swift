import SwiftUI

struct UsageActivityCard: View {
  let daily: [UsageDaily]
  let hourly: [UsageHourly]

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Activity").font(AppTheme.titleFont)
        VStack(alignment: .leading, spacing: 6) {
          Text("Daily tokens").font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
          ForEach(Array(daily.prefix(5))) { row in
            UsageMetricRow(label: row.date, value: "\(row.totalTokens)")
          }
        }
        Divider()
        VStack(alignment: .leading, spacing: 6) {
          Text("Hourly pattern").font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
          ForEach(Array(hourly.prefix(6))) { row in
            UsageMetricRow(label: "\(row.hour):00", value: "\(row.tokens)")
          }
        }
      }
    }
  }
}
