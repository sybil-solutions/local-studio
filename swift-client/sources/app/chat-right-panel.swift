// CRITICAL
import SwiftUI

struct ChatRightPanel: View {
  let route: DrawerRoute
  let sessionId: String?
  let onClose: (() -> Void)?

  @State private var tab: Tab = .activity

  enum Tab: String, CaseIterable, Identifiable {
    case activity = "Activity"
    case context = "Context"
    case files = "Files"
    var id: String { rawValue }
  }

  init(route: DrawerRoute, sessionId: String?, onClose: (() -> Void)? = nil) {
    self.route = route
    self.sessionId = sessionId
    self.onClose = onClose
  }

  var body: some View {
    ZStack {
      AppTheme.chromePanel
        .ignoresSafeArea()
      // A light "aura" similar to the web app's unified sidebar.
      LinearGradient(
         colors: [AppTheme.foreground.opacity(0.02), Color.clear],
        startPoint: .top,
        endPoint: .bottom
      )
      .ignoresSafeArea()
      RadialGradient(
        colors: [AppTheme.link.opacity(0.10), Color.clear],
        center: .topLeading,
        startRadius: 20,
        endRadius: 420
      )
      .ignoresSafeArea()

      VStack(spacing: 0) {
        header
        Divider().overlay(AppTheme.chromeBorder)
        panelBody
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .overlay(alignment: .leading) { Rectangle().fill(AppTheme.chromeBorder).frame(width: 1) }
  }

  private var header: some View {
    HStack(spacing: 8) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          ForEach(Tab.allCases) { t in
            TabButton(title: t.rawValue, isActive: tab == t) { tab = t }
          }
        }
        .padding(.horizontal, 12)
      }
      if let onClose {
        Button(action: onClose) {
          Image(systemName: "xmark")
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(AppTheme.muted)
            .frame(width: 28, height: 28)
             .background(AppTheme.foreground.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .padding(.trailing, 10)
      }
    }
    .padding(.vertical, 10)
  }

  @ViewBuilder
  private var panelBody: some View {
    if route != .chat {
      VStack(spacing: 10) {
        Spacer()
        EmptyStateView("No chat selected", systemImage: "bubble.left.and.bubble.right", message: "Open a chat to view activity, context, and files.")
        Spacer()
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let sessionId {
      switch tab {
      case .activity:
        ChatTracesInspectorView(sessionId: sessionId)
      case .context:
        ChatInspectorContextView(sessionId: sessionId)
      case .files:
        AgentFilesInspectorView(sessionId: sessionId)
      }
    } else {
      VStack(spacing: 10) {
        Spacer()
        EmptyStateView("No chat selected", systemImage: "bubble.left.and.bubble.right", message: "Select a chat from the sidebar.")
        Spacer()
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

private struct TabButton: View {
  let title: String
  let isActive: Bool
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      Text(title)
        .font(AppTheme.captionFont.weight(.semibold))
        .foregroundColor(isActive ? AppTheme.foreground : AppTheme.muted)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
         .background(isActive ? AppTheme.foreground.opacity(0.10) : AppTheme.foreground.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
    .buttonStyle(.plain)
  }
}
