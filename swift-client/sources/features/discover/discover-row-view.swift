import SwiftUI

struct DiscoverRowView: View {
  let model: HfModel
  let isLocal: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(model.modelId).font(.headline)
        Text(model.pipelineTag ?? "").font(.caption).foregroundColor(AppTheme.muted)
        Text("Downloads \(model.downloads ?? 0)").font(.caption).foregroundColor(AppTheme.muted)
      }
      Spacer()
      if isLocal { BadgeView(text: "Local", color: AppTheme.success) }
    }
  }
}
