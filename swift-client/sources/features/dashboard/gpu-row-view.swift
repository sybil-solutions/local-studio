import SwiftUI

struct GpuRowView: View {
  let gpu: GpuInfo

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(gpu.name).font(AppTheme.sectionFont)
      Text("VRAM \(format(gpu.memoryUsed))/\(format(gpu.memoryTotal)) GB")
        .font(AppTheme.captionFont)
        .foregroundColor(AppTheme.muted)
      ProgressBar(value: min(1, gpu.memoryUsed / max(gpu.memoryTotal, 1)))
      Text("Utilization \(Int(gpu.utilization))%")
        .font(AppTheme.captionFont)
        .foregroundColor(AppTheme.muted)
    }
  }

  private func format(_ value: Double) -> String {
    String(format: "%.1f", value / 1024 / 1024 / 1024)
  }
}
