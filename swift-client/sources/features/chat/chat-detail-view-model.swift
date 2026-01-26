import Foundation

@MainActor
final class ChatDetailViewModel: ObservableObject {
  @Published var messages: [StoredMessage] = []
  @Published var input = ""
  @Published var loading = false
  @Published var title = ""
  @Published var sessionModel: String?
  @Published var error: String?

  var api: ApiClient?
  var settings: SettingsStore?
  var sessionId: String = ""
  var tools: [McpTool] = []

  func connect(api: ApiClient, settings: SettingsStore, sessionId: String) {
    self.api = api
    self.settings = settings
    self.sessionId = sessionId
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do {
      let session = try await api.getChatSession(id: sessionId)
      title = session.title
      sessionModel = session.model
      messages = session.messages
      if settings?.mcpEnabled == true { tools = (try? await api.getMcpTools().tools) ?? [] }
    } catch { self.error = error.localizedDescription }
  }

  func sendMessage() async {
    guard let api else { return }
    let content = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !content.isEmpty else { return }
    input = ""
    let user = StoredMessage(id: UUID().uuidString, role: "user", content: content, model: nil, toolCalls: nil)
    messages.append(user)
    _ = try? await api.addMessage(sessionId: sessionId, message: user)
    if let response = await completeChat(api: api) { await handleResponse(response, api: api, userContent: content) }
  }
}
