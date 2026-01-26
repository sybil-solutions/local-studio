import SwiftUI

struct LaunchProgressCard: View {
  let progress: LaunchProgress

  var body: some View {
    CardView {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text("Launch Progress").font(AppTheme.titleFont)
          Spacer()
          BadgeView(text: progress.stage, color: AppTheme.warning)
        }
        Text(progress.message).font(AppTheme.bodyFont)
        if let value = progress.progress { ProgressBar(value: value) }
      }
    }
  }
}
