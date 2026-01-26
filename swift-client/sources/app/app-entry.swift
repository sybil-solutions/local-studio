import SwiftUI

@main
struct VllmStudioApp: App {
  @StateObject private var container = AppContainer()
  @StateObject private var realtime = RealtimeStore()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(container)
        .environmentObject(realtime)
        .onAppear { realtime.start(api: container.api) }
    }
  }
}
