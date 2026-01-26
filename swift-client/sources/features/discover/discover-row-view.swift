import SwiftUI

struct DiscoverRowView: View {
  let model: HfModel
  let isLocal: Bool

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(model.modelId).font(AppTheme.sectionFont)
        Text(model.pipelineTag ?? "").font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
        Text("Downloads \(model.downloads ?? 0)")
          .font(AppTheme.captionFont)
          .foregroundColor(AppTheme.muted)
      }
      Spacer()
      if isLocal { BadgeView(text: "Local", color: AppTheme.success) }
    }
    .padding(.vertical, 6)
  }
}
