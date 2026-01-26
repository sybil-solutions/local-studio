import SwiftUI

struct UsageLatencyCard: View {
  let latency: UsageLatency
  let title: String

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text(title).font(AppTheme.titleFont)
        UsageMetricRow(label: "Avg", value: format(latency.avgMs))
        UsageMetricRow(label: "P50", value: format(latency.p50Ms))
        UsageMetricRow(label: "P95", value: format(latency.p95Ms))
        UsageMetricRow(label: "P99", value: format(latency.p99Ms))
      }
    }
  }

  private func format(_ value: Double) -> String {
    String(format: "%.0f ms", value)
  }
}
