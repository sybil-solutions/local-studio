import SwiftUI

struct UsageTokensCard: View {
  let tokens: TokensPerRequest

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Tokens per Request").font(AppTheme.titleFont)
        UsageMetricRow(label: "Avg", value: format(tokens.avg))
        UsageMetricRow(label: "Avg prompt", value: format(tokens.avgPrompt))
        UsageMetricRow(label: "Avg completion", value: format(tokens.avgCompletion))
        UsageMetricRow(label: "P95", value: format(tokens.p95))
        UsageMetricRow(label: "Max", value: format(tokens.max))
      }
    }
  }

  private func format(_ value: Double) -> String {
    String(format: "%.0f", value)
  }
}
