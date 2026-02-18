// CRITICAL
import SwiftUI

struct LogsView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = LogsViewModel()

  @State private var selected: LogSession?
  @State private var search = ""

  var body: some View {
    GeometryReader { geo in
      let isWide = geo.size.width >= 980

      if isWide {
        HStack(spacing: 0) {
          sidebar
            .frame(width: 320)
          Rectangle().fill(AppTheme.border).frame(width: 1)
          detail
        }
      } else {
        if let selected {
          VStack(spacing: 0) {
            mobileDetailHeader
            Rectangle().fill(AppTheme.border).frame(height: 1)
            LogDetailView(session: selected)
          }
        } else {
          sidebar
        }
      }
    }
    .background(AppTheme.background)
    .onAppear { model.connect(api: container.api) }
    .refreshable { await model.load() }
  }

  private var sidebar: some View {
    VStack(spacing: 0) {
      sidebarHeader
      Rectangle().fill(AppTheme.border).frame(height: 1)
      searchBar
      Rectangle().fill(AppTheme.border).frame(height: 1)
      sessionsList
    }
    .background(AppTheme.card)
  }

  private var sidebarHeader: some View {
    HStack {
      Text("Logs")
        .font(AppTheme.sectionFont)
        .foregroundColor(AppTheme.foreground)
      Spacer()
      Button(action: { Task { await model.load() } }) {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(AppTheme.muted)
          .frame(width: 32, height: 32)
           .background(AppTheme.foreground.opacity(0.06))
          .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.border))
          .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      .buttonStyle(.plain)
    }
    .padding(16)
  }

  private var searchBar: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass")
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(AppTheme.muted)
      TextField("Search logs", text: $search)
        .textFieldStyle(.plain)
        .foregroundColor(AppTheme.foreground)
        #if canImport(UIKit)
        .textInputAutocapitalization(.never)
        #endif
        .autocorrectionDisabled()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
    .background(AppTheme.card)
  }

  private var sessionsList: some View {
    ScrollView(showsIndicators: false) {
      VStack(spacing: 0) {
        if model.sessions.isEmpty && model.loading {
          LoadingView("Loading logs…")
            .padding(.vertical, 20)
        } else if model.sessions.isEmpty {
          EmptyStateView("No logs yet", systemImage: "list.bullet", message: "Run a model or start a chat to generate logs.")
            .padding(.vertical, 40)
        } else {
          ForEach(filteredSessions) { session in
            Button(action: { selected = session }) {
              HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                  Text(session.model ?? session.recipeName ?? session.id)
                    .font(AppTheme.bodyFont.weight(.medium))
                    .foregroundColor(AppTheme.foreground)
                    .lineLimit(1)
                  Text(session.createdAt)
                    .font(AppTheme.captionFont)
                    .foregroundColor(AppTheme.muted)
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
              }
              .padding(.horizontal, 16)
              .padding(.vertical, 12)
             .background(selected?.id == session.id ? AppTheme.cardHover : Color.clear)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
              Button("Delete", role: .destructive) {
                Task { await model.delete(id: session.id) }
              }
            }

            Rectangle().fill(AppTheme.border.opacity(0.5)).frame(height: 1)
              .padding(.leading, 16)
          }
        }
      }
    }
  }

  private var detail: some View {
    Group {
      if let selected {
        LogDetailView(session: selected)
      } else {
        EmptyStateView("Select a log", systemImage: "scroll", message: "Choose a session from the left.")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AppTheme.background)
  }

  private var mobileDetailHeader: some View {
    HStack(spacing: 10) {
      Button(action: { selected = nil }) {
        Image(systemName: "chevron.left")
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(AppTheme.foreground)
          .frame(width: 32, height: 32)
           .background(AppTheme.foreground.opacity(0.06))
          .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.border))
          .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      .buttonStyle(.plain)
      Text("Logs")
        .font(AppTheme.sectionFont)
        .foregroundColor(AppTheme.foreground)
      Spacer()
    }
    .padding(16)
    .background(AppTheme.card)
  }

  private var filteredSessions: [LogSession] {
    let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !q.isEmpty else { return model.sessions }
    return model.sessions.filter { session in
      let title = (session.model ?? session.recipeName ?? session.id).lowercased()
      return title.contains(q) || session.createdAt.lowercased().contains(q)
    }
  }
}
