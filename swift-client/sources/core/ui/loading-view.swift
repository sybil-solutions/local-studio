import SwiftUI

struct LoadingView: View {
  let text: String
  init(_ text: String = "Loading...") { self.text = text }

  var body: some View {
    VStack(spacing: 12) {
      ProgressView()
      Text(text).font(AppTheme.bodyFont).foregroundColor(AppTheme.muted)
    }
    .padding(16)
  }
}
