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
            Text(session.title).font(.headline)
            Text(session.updatedAt).font(.caption).foregroundColor(AppTheme.muted)
          }
        }
      }
      .onDelete { indexSet in
        Task { for index in indexSet { await model.deleteSession(id: model.sessions[index].id) } }
      }
    }
    .overlay(model.loading ? LoadingView() : nil)
    .navigationTitle("Chats")
    .toolbar {
      Button("New") { Task { await createSession() } }
    }
    .onAppear { model.connect(api: container.api) }
    .background(
      NavigationLink("", destination: ChatDetailView(sessionId: newSessionId ?? ""),
                     isActive: Binding(get: { newSessionId != nil }, set: { if !$0 { newSessionId = nil } }))
        .hidden()
    )
  }

  private func createSession() async {
    if let session = await model.createSession() { newSessionId = session.id }
  }
}
