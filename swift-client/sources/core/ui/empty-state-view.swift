import SwiftUI

struct EmptyStateView: View {
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 8) {
      Text(title).font(AppTheme.titleFont)
      Text(message).font(AppTheme.bodyFont).foregroundColor(AppTheme.muted)
    }
    .padding(20)
  }
}
