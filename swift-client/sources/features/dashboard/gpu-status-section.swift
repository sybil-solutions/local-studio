import SwiftUI

struct GpuStatusSection: View {
  let gpus: [GpuInfo]

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 12) {
        Text("GPUs").font(AppTheme.titleFont)
        if gpus.isEmpty {
          Text("No GPUs detected").foregroundColor(AppTheme.muted)
        } else {
          ForEach(gpus) { gpu in
            GpuRowView(gpu: gpu)
            if gpu.id != gpus.last?.id { Divider() }
          }
        }
      }
    }
  }
}
