import SwiftUI

struct RootView: View {
  var body: some View {
    TabShell()
      .tint(AppTheme.accentStrong)
      .background(AppTheme.background.ignoresSafeArea())
  }
}
