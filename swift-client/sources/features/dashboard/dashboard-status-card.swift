import SwiftUI

struct DashboardStatusCard: View {
  let status: StatusResponse?
  let connected: Bool

  private var isRunning: Bool {
    status?.running == true || status?.process != nil
  }

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Controller").font(AppTheme.titleFont)
          Spacer()
          BadgeView(text: connected ? "Live" : "Offline", color: connected ? AppTheme.success : AppTheme.error)
        }
        Text(isRunning ? "Model running" : "No model running")
          .font(AppTheme.bodyFont)
        if let model = status?.process?.servedModelName ?? status?.process?.modelPath {
          Text("Model: \(model)").font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
        }
        Text("Port: \(status?.inferencePort ?? 8000)")
          .font(AppTheme.captionFont)
          .foregroundColor(AppTheme.muted)
      }
    }
  }
}
