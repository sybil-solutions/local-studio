import SwiftUI

struct ChatListView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ChatListViewModel()
  @State private var selectedSessionId: String?

  var body: some View {
    List {
      ForEach(model.sessions) { session in
        NavigationLink(
          destination: ChatDetailView(sessionId: session.id),
          tag: session.id,
          selection: $selectedSessionId
        ) {
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
    .toolbar {
      Button("New") { Task { await createSession() } }
    }
    .onAppear { model.connect(api: container.api) }
  }

  private func createSession() async {
    guard let session = await model.createSession() else { return }
    selectedSessionId = session.id
    await model.load()
  }
}
