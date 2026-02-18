import Combine
import SwiftUI

@main
struct VllmStudioApp: App {
  @StateObject private var container = AppContainer()
  @StateObject private var realtime = RealtimeStore()
  @StateObject private var themeManager: ThemeManager

  init() {
    let container = AppContainer()
    _container = StateObject(wrappedValue: container)
    _realtime = StateObject(wrappedValue: RealtimeStore())
    _themeManager = StateObject(wrappedValue: ThemeManager(settingsStore: container.settings))
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(container)
        .environmentObject(realtime)
        .environmentObject(themeManager)
        .environment(\.theme, themeManager)
        .onAppear { realtime.start(api: container.api) }
        // Avoid "stuck offline" after changing backend settings.
        .onReceive(container.settings.$backendUrl.dropFirst().debounce(for: .milliseconds(600), scheduler: RunLoop.main)) { _ in
          realtime.start(api: container.api)
        }
        .onReceive(container.settings.$apiKey.dropFirst().debounce(for: .milliseconds(600), scheduler: RunLoop.main)) { _ in
          realtime.start(api: container.api)
        }
    }
  }
}
