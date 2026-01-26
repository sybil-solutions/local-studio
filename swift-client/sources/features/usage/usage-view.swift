import SwiftUI

struct UsageView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = UsageViewModel()

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        if let totals = model.stats?.totals { UsageSummaryCard(totals: totals) }
        if let latency = model.stats?.latency { UsageLatencyCard(latency: latency, title: "Latency") }
        if let ttft = model.stats?.ttft { UsageLatencyCard(latency: ttft, title: "TTFT") }
        if let tokens = model.stats?.tokensPerRequest { UsageTokensCard(tokens: tokens) }
        if let cache = model.stats?.cache { UsageCacheCard(cache: cache) }
        if let rows = model.stats?.byModel, !rows.isEmpty {
          CardView {
            VStack(alignment: .leading, spacing: 8) {
              Text("Top Models").font(AppTheme.titleFont)
              ForEach(Array(rows.prefix(5))) { row in
                UsageModelRowView(row: row)
                if row.id != Array(rows.prefix(5)).last?.id { Divider() }
              }
            }
          }
        }
        if let daily = model.stats?.daily, let hourly = model.stats?.hourlyPattern {
          UsageActivityCard(daily: daily, hourly: hourly)
        }
      }
      .padding(16)
    }
    .background(AppTheme.background)
    .navigationTitle("Usage")
    .onAppear { model.connect(api: container.api) }
    .overlay(model.loading ? LoadingView() : nil)
  }
}
