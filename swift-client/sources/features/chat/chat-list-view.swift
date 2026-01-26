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
            Text(session.title).font(AppTheme.sectionFont)
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
    .navigationDestination(isPresented: Binding(get: { newSessionId != nil }, set: { if !$0 { newSessionId = nil } })) {
      if let sessionId = newSessionId { ChatDetailView(sessionId: sessionId) }
    }
  }

  private func createSession() async {
    guard let session = await model.createSession() else { return }
    newSessionId = session.id
    await model.load()
  }
}
