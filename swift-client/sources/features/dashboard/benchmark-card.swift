import SwiftUI

struct BenchmarkCard: View {
  let result: BenchmarkResult

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        Text("Benchmark").font(AppTheme.titleFont)
        if let stats = result.benchmark {
          Text("Tokens: \(stats.completionTokens)")
          Text("Time: \(String(format: "%.2f", stats.totalTimeS))s")
          Text("TPS: \(String(format: "%.1f", stats.generationTps))")
        } else {
          Text(result.error ?? "No benchmark data")
            .foregroundColor(AppTheme.muted)
        }
      }
    }
  }
}
