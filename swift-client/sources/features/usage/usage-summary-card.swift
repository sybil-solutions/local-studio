import SwiftUI

struct UsageSummaryCard: View {
  let totals: UsageTotals

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Totals").font(AppTheme.titleFont)
        UsageMetricRow(label: "Total tokens", value: "\(totals.totalTokens)")
        UsageMetricRow(label: "Prompt tokens", value: "\(totals.promptTokens)")
        UsageMetricRow(label: "Completion tokens", value: "\(totals.completionTokens)")
        UsageMetricRow(label: "Requests", value: "\(totals.totalRequests)")
        UsageMetricRow(label: "Success rate", value: String(format: "%.1f%%", totals.successRate))
        UsageMetricRow(label: "Unique sessions", value: "\(totals.uniqueSessions)")
      }
    }
  }
}
