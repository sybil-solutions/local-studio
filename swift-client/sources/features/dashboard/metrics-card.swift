import SwiftUI

struct MetricsCard: View {
  let metrics: Metrics

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Metrics").font(AppTheme.titleFont)
        Text("Throughput: \(format(metrics.throughput))")
        Text("Latency: \(format(metrics.latencyAvg)) ms")
        Text("Tokens: \(format(metrics.tokensTotal))")
      }
    }
  }

  private func format(_ value: Double?) -> String {
    guard let value else { return "-" }
    return String(format: "%.1f", value)
  }
}
