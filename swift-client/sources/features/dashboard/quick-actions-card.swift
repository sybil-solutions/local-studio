import SwiftUI

struct QuickActionsCard: View {
  let onBenchmark: () -> Void

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 12) {
        Text("Quick Actions").font(AppTheme.titleFont)
        HStack {
          Button("Run Benchmark", action: onBenchmark)
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.accentStrong)
          NavigationLink("Logs", destination: LogsView())
            .buttonStyle(.bordered)
          NavigationLink("Chat", destination: ChatListView())
            .buttonStyle(.bordered)
        }
      }
    }
  }
}
