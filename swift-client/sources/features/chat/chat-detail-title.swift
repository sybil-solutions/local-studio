import Foundation

extension ChatDetailViewModel {
  func updateTitle(user: String, assistant: String, api: ApiClient) async {
    guard title == "New Chat" else { return }
    if let response = try? await api.generateTitle(model: sessionModel, user: user, assistant: assistant) {
      title = response.title
      _ = try? await api.updateChatSession(id: sessionId, title: response.title, model: nil)
    }
  }
}
