// CRITICAL
import Combine
import Foundation

@MainActor
final class ChatDetailViewModel: ObservableObject {
  @Published var messages: [StoredMessage] = []
  @Published var input = ""
  @Published var loading = false
  @Published var title = ""
  @Published var sessionModel: String?
  @Published var availableModels: [OpenAIModelInfo] = []
  @Published var chatUsage: ChatUsage?
  @Published var systemPrompt = ""
  @Published var deepResearchEnabled = false
  @Published var error: String?
  @Published var agentMeta: [String: AgentMeta] = [:]
  var api: ApiClient?
  var settings: SettingsStore?
  var sessionId: String = ""
  var tools: [McpTool] = []
  let openAIService = OpenAIChatService()
  private var cancellables: Set<AnyCancellable> = []

  init() {
    openAIService.objectWillChange
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &cancellables)
  }

  func connect(api: ApiClient, settings: SettingsStore, sessionId: String) {
    self.api = api
    self.settings = settings
    self.sessionId = sessionId
    openAIService.configure(apiKey: settings.apiKey, baseURL: settings.backendUrl)
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
      tools = (try? await api.getMcpTools().tools) ?? []
      rebuildAgentMeta()
      availableModels = await fetchModels(api: api)
      let defaultModel = availableModels.first(where: { $0.active == true })?.id ?? availableModels.first?.id
      if sessionModel == nil || !availableModels.contains(where: { $0.id == sessionModel }) {
        sessionModel = defaultModel
        if let defaultModel { _ = try? await api.updateChatSession(id: sessionId, title: nil, model: defaultModel) }
      }
      chatUsage = try? await api.getChatUsage(sessionId: sessionId)
    } catch { self.error = error.localizedDescription }
  }

  func updateModel(_ model: String) async {
    guard let api else { return }
    sessionModel = model
    _ = try? await api.updateChatSession(id: sessionId, title: nil, model: model)
  }

  var isStreaming: Bool { openAIService.isStreaming }
  var streamStart: Date? { openAIService.streamStart }
  var streamingContent: String { openAIService.streamingContent }
  var streamingReasoning: String { openAIService.streamingReasoning }
  var streamingToolCalls: [ToolCall] { openAIService.streamingToolCalls }

  private func fetchModels(api: ApiClient) async -> [OpenAIModelInfo] {
    guard let list = try? await api.getServedModels() else { return [] }
    return list.data.sorted { left, right in
      if left.active == true && right.active != true { return true }
      if right.active == true && left.active != true { return false }
      return left.id.localizedCaseInsensitiveCompare(right.id) == .orderedAscending
    }
  }
}
