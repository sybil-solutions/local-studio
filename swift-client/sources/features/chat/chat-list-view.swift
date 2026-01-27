import SwiftUI

struct ChatListView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ChatListViewModel()
  @State private var newSessionId: String?

  var body: some View {
    List {
      ForEach(model.sessions) { session in
        NavigationLink(destination: ChatDetailView(sessionId: session.id)) {
          VStack(alignment: .leading, spacing: 4) {
            Text(session.title.isEmpty ? "New chat" : session.title)
              .font(AppTheme.bodyFont.weight(.semibold))
              .lineLimit(1)
            Text(session.updatedAt).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
          }
        }
        .listRowBackground(AppTheme.card)
      }
      .onDelete { indexSet in
        Task { for index in indexSet { await model.deleteSession(id: model.sessions[index].id) } }
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .background(AppTheme.background)
    .overlay(model.loading ? LoadingView() : nil)
    .navigationTitle("Chats")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      Button("New") { Task { await createSession() } }
    }
    .onAppear { model.connect(api: container.api) }
    .background(navigationLink)
  }

  @ViewBuilder
  private var navigationLink: some View {
    NavigationLink(
      destination: Group {
        if let newSessionId {
          ChatDetailView(sessionId: newSessionId)
        } else {
          EmptyView()
        }
      },
      isActive: Binding(
        get: { newSessionId != nil },
        set: { if !$0 { newSessionId = nil } }
      )
    ) {
      EmptyView()
    }
    .hidden()
  }

  @MainActor
  private func createSession() async {
    guard let session = await model.createSession() else { return }
    newSessionId = session.id
    await model.load()
  }
}
