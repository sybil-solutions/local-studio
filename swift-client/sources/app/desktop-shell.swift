// CRITICAL
import SwiftUI

struct DesktopShell: View {
  @EnvironmentObject private var container: AppContainer

  @State private var route: DrawerRoute = .dashboard
  @State private var selectedChatId: String?
  @State private var inspectorVisible = false
  @State private var inspectorWidth: CGFloat = 420

  @GestureState private var dragOffset: CGFloat = 0

  @StateObject private var chats = ChatListViewModel()

  var body: some View {
    HStack(spacing: 0) {
      StudioSidebar(
        route: $route,
        selectedChatId: $selectedChatId,
        sessions: chats.sessions,
        sessionsLoading: chats.loading,
        onNewChat: { Task { await createChat() } },
        onDeleteChat: { id in Task { await chats.deleteSession(id: id) } }
      )
      mainColumn
      if route == .chat && inspectorVisible {
        resizableInspector
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AppTheme.background.ignoresSafeArea())
    .onAppear {
      chats.connect(api: container.api)
    }
    .onChange(of: route) { oldValue, newValue in
      if newValue != .chat {
        inspectorVisible = false
        selectedChatId = nil
      }
    }
    .onChange(of: selectedChatId) { oldValue, newValue in
      if newValue == nil {
        inspectorVisible = false
      }
    }
  }

  private var resizableInspector: some View {
    ChatRightPanel(route: route, sessionId: selectedChatId, onClose: { inspectorVisible = false })
      .frame(width: max(280, min(800, inspectorWidth + dragOffset)))
      .gesture(
        DragGesture()
          .updating($dragOffset) { value, state, _ in
            state = value.translation.width
          }
          .onEnded { value in
            let newWidth = inspectorWidth + value.translation.width
            inspectorWidth = max(280, min(800, newWidth))
          }
      )
      .overlay(alignment: .leading) {
        Rectangle()
          .fill(Color.clear)
          .contentShape(Rectangle().size(width: 8, height: .infinity))
          .gesture(
            DragGesture()
              .onChanged { value in
                let newWidth = inspectorWidth + value.translation.width
                if newWidth >= 280 && newWidth <= 800 {
                  inspectorWidth = newWidth
                }
              }
          )
      }
      .transition(.move(edge: .trailing))
  }

  private var mainColumn: some View {
    ZStack {
      AppTheme.background.ignoresSafeArea()
      NavigationStack {
        contentView
      }
      .tint(AppTheme.link)
      #if canImport(UIKit)
      .toolbar(.hidden, for: .navigationBar)
      .toolbarBackground(.hidden, for: .navigationBar)
      #endif
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .overlay(alignment: .topTrailing) {
      if route == .chat && selectedChatId != nil {
        Button(action: { withAnimation(.easeInOut(duration: 0.15)) { inspectorVisible.toggle() } }) {
          Image(systemName: "sidebar.right")
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(AppTheme.muted)
            .frame(width: 34, height: 34)
            .background(AppTheme.card)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.border))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .padding(.top, 10)
        .padding(.trailing, 12)
      }
    }
  }

  @ViewBuilder
  private var contentView: some View {
    switch route {
    case .dashboard: DashboardView()
    case .recipes: RecipesView()
    case .discover: DiscoverView()
    case .logs: LogsView()
    case .usage: UsageView()
    case .settings: ConfigsView()
    case .chat:
      if let selectedChatId {
        ChatDetailView(
          sessionId: selectedChatId,
          showsBackButton: false,
          onSessionNotFound: { [self] in
            self.selectedChatId = nil
            Task { await chats.load() }
          }
        )
        .id(selectedChatId)
      } else {
        VStack(spacing: 10) {
          Spacer()
          EmptyStateView("Select a chat", systemImage: "bubble.left.and.bubble.right", message: "Choose a conversation on the left, or start a new one.")
          Button(action: { Task { await createChat() } }) {
            Text("New Chat")
              .font(AppTheme.bodyFont.weight(.semibold))
              .foregroundColor(AppTheme.foreground)
              .padding(.horizontal, 14)
              .padding(.vertical, 10)
              .background(AppTheme.foreground.opacity(0.10))
              .clipShape(RoundedRectangle(cornerRadius: 12))
          }
          .buttonStyle(.plain)
          Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
      }
    }
  }

  @MainActor
  private func createChat() async {
    guard let created = await chats.createSession() else { return }
    route = .chat
    selectedChatId = created.id
    await chats.load()
  }
}
