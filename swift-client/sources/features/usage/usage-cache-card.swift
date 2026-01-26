import SwiftUI

struct UsageCacheCard: View {
  let cache: UsageCache

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Cache").font(AppTheme.titleFont)
        UsageMetricRow(label: "Hit rate", value: String(format: "%.1f%%", cache.hitRate))
        UsageMetricRow(label: "Hits", value: "\(cache.hits)")
        UsageMetricRow(label: "Misses", value: "\(cache.misses)")
        UsageMetricRow(label: "Hit tokens", value: "\(cache.hitTokens)")
      }
    }
  }
}
