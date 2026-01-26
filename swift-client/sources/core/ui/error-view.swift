import SwiftUI

struct ErrorView: View {
  let message: String
  let retry: (() -> Void)?

  var body: some View {
    VStack(spacing: 12) {
      Text(message).font(AppTheme.bodyFont).foregroundColor(AppTheme.error)
      if let retry {
        Button("Retry", action: retry)
          .buttonStyle(.borderedProminent)
          .tint(AppTheme.accentStrong)
      }
    }
    .padding(16)
  }
}
