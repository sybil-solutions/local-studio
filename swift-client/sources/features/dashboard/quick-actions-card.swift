import SwiftUI

struct QuickActionsCard: View {
  let connected: Bool
  let onBenchmark: () -> Void

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 12) {
        Text("Quick Actions")
          .font(AppTheme.sectionFont)
          .foregroundColor(AppTheme.foreground)
        HStack(spacing: 12) {
          Button(action: onBenchmark) {
            HStack(spacing: 6) {
              Image(systemName: "speedometer")
              Text("Run Benchmark")
            }
            .font(AppTheme.bodyFont.weight(.medium))
            .foregroundColor(AppTheme.foreground)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(connected ? AppTheme.accentStrong : AppTheme.muted)
            .cornerRadius(10)
          }
          .buttonStyle(.plain)
          .disabled(!connected)
        }
      }
    }
  }
}
