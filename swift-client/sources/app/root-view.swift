import SwiftUI

struct RootView: View {
  var body: some View {
    DrawerShell()
      .tint(AppTheme.accentStrong)
      .foregroundColor(AppTheme.foreground)
      .font(AppTheme.bodyFont)
      .background(AppTheme.background.ignoresSafeArea())
      .preferredColorScheme(ColorScheme.dark)
  }
}
