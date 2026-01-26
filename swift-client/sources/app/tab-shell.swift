import SwiftUI

struct TabShell: View {
  var body: some View {
    TabView {
      NavigationStack { DashboardView() }
        .tabItem { Label("Dashboard", systemImage: "gauge") }
      NavigationStack { ChatListView() }
        .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
      NavigationStack { DiscoverView() }
        .tabItem { Label("Discover", systemImage: "sparkles") }
      NavigationStack { UsageView() }
        .tabItem { Label("Usage", systemImage: "chart.bar") }
      NavigationStack { ConfigsView() }
        .tabItem { Label("Configs", systemImage: "slider.horizontal.3") }
    }
  }
}
