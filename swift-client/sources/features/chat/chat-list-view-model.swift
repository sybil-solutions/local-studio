import Foundation

@MainActor
final class ChatListViewModel: ObservableObject {
  @Published var sessions: [ChatSession] = []
  @Published var loading = false
  @Published var error: String?

  private var api: ApiClient?

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do { sessions = try await api.getChatSessions() }
    catch { self.error = error.localizedDescription }
  }

  func createSession() async -> ChatSessionDetail? {
    guard let api else { return nil }
    return try? await api.createChatSession(title: "New Chat", model: nil)
  }

  func deleteSession(id: String) async {
    guard let api else { return }
    _ = try? await api.deleteChatSession(id: id)
    await load()
  }
}
