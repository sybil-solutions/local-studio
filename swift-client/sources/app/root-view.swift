// CRITICAL
import SwiftUI

struct RootView: View {
  @Environment(\.horizontalSizeClass) private var horizontalSizeClass
  @EnvironmentObject private var themeManager: ThemeManager

  var body: some View {
    Group {
      if shouldUseDesktopShell {
        DesktopShell()
      } else {
        DrawerShell()
      }
    }
    .theme(themeManager.currentTheme)
    .accentTint(themeManager.currentTheme)
    .preferredColorScheme(.dark)
  }

  private var shouldUseDesktopShell: Bool {
    #if os(macOS)
    true
    #else
    horizontalSizeClass == .regular
    #endif
  }
}
