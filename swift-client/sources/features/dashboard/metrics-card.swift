import SwiftUI

struct MetricsCard: View {
  let metrics: Metrics

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Metrics").font(AppTheme.titleFont)
        MetricRow(label: "Total tokens", value: format(totalTokens))
        MetricRow(label: "Requests", value: format(metrics.lifetimeRequests))
        MetricRow(label: "Prompt tps", value: format(metrics.promptThroughput))
        MetricRow(label: "Generation tps", value: format(metrics.generationThroughput))
        MetricRow(label: "Running", value: format(metrics.runningRequests))
        MetricRow(label: "Power (W)", value: format(metrics.currentPowerWatts))
      }
    }
  }

  private var totalTokens: Double? {
    if let prompt = metrics.lifetimePromptTokens, let completion = metrics.lifetimeCompletionTokens {
      return prompt + completion
    }
    return nil
  }

  private func format(_ value: Double?) -> String {
    guard let value else { return "-" }
    return value < 10 ? String(format: "%.2f", value) : String(format: "%.1f", value)
  }
}
