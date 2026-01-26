import Foundation

extension ChatDetailViewModel {
  func updateTitle(user: String, assistant: String, api: ApiClient) async {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let defaults = ["", "new chat", "untitled", "chat"]
    guard defaults.contains(trimmed) else { return }
    if let response = try? await api.generateTitle(model: sessionModel, user: user, assistant: assistant) {
      title = response.title
      _ = try? await api.updateChatSession(id: sessionId, title: response.title, model: nil)
    }
  }
}
