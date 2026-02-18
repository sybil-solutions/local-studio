// CRITICAL
import SwiftUI

struct StudioSidebar: View {
  @Binding var route: DrawerRoute
  @Binding var selectedChatId: String?

  let sessions: [ChatSession]
  let sessionsLoading: Bool
  let onNewChat: () -> Void
  let onDeleteChat: (String) -> Void

  @AppStorage("studio.sidebar.collapsed") private var collapsed = false
  @State private var chatHistoryOpen = true

  private var width: CGFloat { collapsed ? 64 : 224 }

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView(showsIndicators: false) {
        VStack(alignment: .leading, spacing: 10) {
          navSection
          if route == .chat {
            chatSection
          }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
      }
      footer
    }
    .frame(width: width, alignment: .topLeading)
    .frame(maxHeight: .infinity)
    .background(AppTheme.chromeSidebar)
    .overlay(alignment: .trailing) { Rectangle().fill(AppTheme.chromeBorder).frame(width: 1) }
  }

  private var header: some View {
    HStack(spacing: collapsed ? 0 : 10) {
      ZStack {
        RoundedRectangle(cornerRadius: 7)
        .fill(AppTheme.foreground.opacity(0.08))
          .frame(width: 28, height: 28)
        Image(systemName: "hexagon.fill")
          .font(.system(size: 14, weight: .semibold))
          .foregroundColor(AppTheme.foreground.opacity(0.92))
      }

      if !collapsed {
        Text("vLLM Studio")
          .font(AppTheme.sectionFont)
          .foregroundColor(AppTheme.foreground)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(height: 56)
    .overlay(alignment: .bottom) { Rectangle().fill(AppTheme.chromeBorder).frame(height: 1) }
  }

  private var navSection: some View {
    VStack(alignment: .leading, spacing: 2) {
      if !collapsed {
        Text("Navigation")
          .font(AppTheme.captionFont.weight(.medium))
          .foregroundColor(AppTheme.muted)
          .padding(.horizontal, 6)
          .padding(.bottom, 4)
      }

      ForEach(DrawerRoute.allCases) { item in
        NavRow(
          title: item.title,
          icon: item.icon,
          collapsed: collapsed,
          isActive: route == item,
          onTap: { route = item }
        )
      }
    }
  }

  private var chatSection: some View {
    VStack(alignment: .leading, spacing: 8) {
      if !collapsed {
        HStack(spacing: 8) {
          Button(action: { chatHistoryOpen.toggle() }) {
            HStack(spacing: 6) {
              Text("Chats")
                .font(AppTheme.captionFont.weight(.medium))
                .foregroundColor(AppTheme.muted)
              Image(systemName: chatHistoryOpen ? "chevron.down" : "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(AppTheme.muted)
            }
          }
          .buttonStyle(.plain)
          Spacer()
          Button(action: onNewChat) {
            Label("New Chat", systemImage: "plus")
              .labelStyle(.iconOnly)
              .font(.system(size: 12, weight: .semibold))
              .foregroundColor(AppTheme.foreground)
              .frame(width: 28, height: 28)
            .background(AppTheme.foreground.opacity(0.08))
              .clipShape(RoundedRectangle(cornerRadius: 10))
          }
          .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
      } else {
        Button(action: onNewChat) {
          Image(systemName: "plus")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(AppTheme.foreground)
            .frame(width: 40, height: 34)
            .background(AppTheme.foreground.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .padding(.top, 6)
        .frame(maxWidth: .infinity)
      }

      if chatHistoryOpen {
        VStack(spacing: 2) {
          if sessionsLoading && sessions.isEmpty {
            if !collapsed {
              Text("Loading…")
                .font(AppTheme.captionFont)
                .foregroundColor(AppTheme.muted)
                .padding(.horizontal, 6)
                .padding(.vertical, 8)
            }
          }

          ForEach(sessions) { session in
            ChatRow(
              title: session.title.isEmpty ? "New chat" : session.title,
              subtitle: session.updatedAt,
              collapsed: collapsed,
              isActive: selectedChatId == session.id,
              onTap: { selectedChatId = session.id },
              onDelete: { onDeleteChat(session.id) }
            )
          }

          if sessions.isEmpty && !sessionsLoading && !collapsed {
            Text("No chats yet")
              .font(AppTheme.captionFont)
              .foregroundColor(AppTheme.muted)
              .padding(.horizontal, 6)
              .padding(.vertical, 8)
          }
        }
      }
    }
  }

  private var footer: some View {
    HStack {
      Spacer()
      Button(action: { collapsed.toggle() }) {
        Image(systemName: collapsed ? "chevron.right" : "chevron.left")
          .font(.system(size: 12, weight: .semibold))
          .foregroundColor(AppTheme.muted)
          .frame(width: 28, height: 28)
           .background(AppTheme.chromeSidebar.opacity(0.9))
          .overlay(RoundedRectangle(cornerRadius: 999).stroke(AppTheme.chromeBorderStrong))
          .clipShape(Circle())
      }
      .buttonStyle(.plain)
      Spacer()
    }
    .padding(.vertical, 10)
    .overlay(alignment: .top) { Rectangle().fill(AppTheme.chromeBorder).frame(height: 1) }
  }
}

private struct NavRow: View {
  let title: String
  let icon: String
  let collapsed: Bool
  let isActive: Bool
  let onTap: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: collapsed ? 0 : 10) {
        Image(systemName: icon)
          .font(.system(size: 14, weight: .medium))
          .frame(width: 18)
        if !collapsed {
          Text(title)
            .font(AppTheme.bodyFont.weight(.medium))
            .lineLimit(1)
          Spacer(minLength: 0)
        }
      }
      .foregroundColor(isActive ? AppTheme.foreground : AppTheme.muted)
      .padding(.horizontal, collapsed ? 0 : 10)
      .frame(height: 36)
      .frame(maxWidth: .infinity, alignment: collapsed ? .center : .leading)
      .background(isActive ? AppTheme.foreground.opacity(0.08) : Color.clear)
      .clipShape(RoundedRectangle(cornerRadius: 10))
    }
    .buttonStyle(.plain)
  }
}

private struct ChatRow: View {
  let title: String
  let subtitle: String
  let collapsed: Bool
  let isActive: Bool
  let onTap: () -> Void
  let onDelete: () -> Void

  var body: some View {
    Button(action: onTap) {
      HStack(spacing: 10) {
        if collapsed {
          Image(systemName: "bubble.left")
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(isActive ? AppTheme.foreground : AppTheme.muted)
            .frame(width: 40, height: 32)
            .background(isActive ? AppTheme.foreground.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        } else {
          VStack(alignment: .leading, spacing: 2) {
            Text(title)
              .font(AppTheme.bodyFont.weight(.semibold))
              .foregroundColor(AppTheme.foreground)
              .lineLimit(1)
            Text(subtitle)
              .font(AppTheme.captionFont)
              .foregroundColor(AppTheme.muted)
              .lineLimit(1)
          }
          Spacer(minLength: 0)
        }
      }
      .padding(.horizontal, collapsed ? 0 : 10)
      .frame(height: collapsed ? 34 : 44)
      .frame(maxWidth: .infinity, alignment: collapsed ? .center : .leading)
      .background(!collapsed && isActive ? AppTheme.foreground.opacity(0.06) : Color.clear)
      .clipShape(RoundedRectangle(cornerRadius: 10))
    }
    .buttonStyle(.plain)
    .contextMenu {
      Button("Delete", role: .destructive, action: onDelete)
    }
  }
}
