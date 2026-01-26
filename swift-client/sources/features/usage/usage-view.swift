import SwiftUI

struct UsageView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = UsageViewModel()

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        if let totals = model.stats?.totals {
          HStack {
            UsageMetricCard(title: "Total Tokens", value: "\(totals.totalTokens)", subtitle: "Requests \(totals.totalRequests)")
            UsageMetricCard(title: "Success", value: "\(totals.successRate)%", subtitle: "Failures \(totals.failedRequests)")
          }
        }
        if let latency = model.stats?.latency {
          UsageMetricCard(title: "Latency", value: "\(Int(latency.avgMs)) ms", subtitle: "P95 \(Int(latency.p95Ms)) ms")
        }
        if let rows = model.stats?.byModel, !rows.isEmpty {
          CardView {
            VStack(alignment: .leading, spacing: 8) {
              Text("Top Models").font(AppTheme.titleFont)
              ForEach(rows.prefix(5)) { row in
                UsageModelRowView(row: row)
                if row.id != rows.prefix(5).last?.id { Divider() }
              }
            }
          }
        }
      }
      .padding(16)
    }
    .navigationTitle("Usage")
    .onAppear { model.connect(api: container.api) }
    .overlay(model.loading ? LoadingView() : nil)
  }
}
