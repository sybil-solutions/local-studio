import SwiftUI

struct DashboardView: View {
  @EnvironmentObject private var container: AppContainer
  @EnvironmentObject private var realtime: RealtimeStore
  @StateObject private var model = DashboardViewModel()

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        DashboardStatusCard(status: realtime.status, connected: realtime.isConnected)
        if let progress = realtime.launchProgress { LaunchProgressCard(progress: progress) }
        GpuStatusSection(gpus: realtime.gpus)
        if let metrics = realtime.metrics { MetricsCard(metrics: metrics) }
        DashboardLogsCard(session: model.logSession, lines: model.logLines)
        QuickActionsCard { Task { await model.benchmark(prompt: 1000, max: 100) } }
        RecipeSection(
          recipes: model.recipes,
          onLaunch: { id in Task { await model.launch(recipeId: id) } },
          onEvict: { Task { await model.evict() } }
        )
        if let benchmark = model.benchmark { BenchmarkCard(result: benchmark) }
      }
      .padding(16)
    }
    .background(AppTheme.background)
    .navigationTitle("Dashboard")
    .onAppear { model.connect(api: container.api) }
    .refreshable { await model.load() }
  }
}
