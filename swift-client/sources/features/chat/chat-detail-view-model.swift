// CRITICAL
import Combine
import Foundation
import UIKit

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
  @Published var currentPlan: [PlanTask]?
  var api: ApiClient?
  var settings: SettingsStore?
  var sessionId: String = ""
  var tools: [McpTool] = []
  let openAIService: OpenAIChatService
  private var cancellables: Set<AnyCancellable> = []

  init() {
    let service = OpenAIChatService()
    openAIService = service
    service.$isStreaming
      .removeDuplicates()
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &cancellables)
    service.$streamingContent
      .throttle(for: .milliseconds(100), scheduler: RunLoop.main, latest: true)
      .sink { [weak self] _ in self?.objectWillChange.send() }
      .store(in: &cancellables)
    service.$streamingReasoning
      .throttle(for: .milliseconds(100), scheduler: RunLoop.main, latest: true)
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
      refreshUsageSnapshot()
      tools = (try? await api.getMcpTools().tools) ?? []
      rebuildAgentMeta()
      availableModels = await fetchModels(api: api)
      let defaultModel = availableModels.first(where: { $0.active == true })?.id ?? availableModels.first?.id
      if sessionModel == nil || !availableModels.contains(where: { $0.id == sessionModel }) {
        sessionModel = defaultModel
        if let defaultModel { _ = try? await api.updateChatSession(id: sessionId, title: nil, model: defaultModel) }
      }
      chatUsage = try? await api.getChatUsage(sessionId: sessionId)
      if chatUsage == nil { refreshUsageSnapshot() }
    } catch { self.error = error.localizedDescription }
  }

  func updateModel(_ model: String) async {
    guard let api else { return }
    sessionModel = model
    _ = try? await api.updateChatSession(id: sessionId, title: nil, model: model)
  }

  func copyTranscript() {
    UIPasteboard.general.string = buildTranscript()
  }

  func copyMessage(_ message: StoredMessage) {
    let content = cleanedContent(for: message)
    guard !content.isEmpty else { return }
    UIPasteboard.general.string = content
  }

  func cleanedContent(for message: StoredMessage) -> String {
    var content = message.content ?? ""
    if message.role == "assistant" {
      content = ThinkingParser.stripThinkingBlocks(content)
      content = ArtifactParser.stripArtifactBlocks(content)
    }
    return content.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  func buildTranscript(includeToolMessages: Bool = true) -> String {
    var lines: [String] = []
    for message in messages {
      if message.role == "tool", !includeToolMessages { continue }
      let label = message.role == "assistant" ? "Assistant" : message.role.capitalized
      var content = message.content ?? ""
      if message.role == "assistant" {
        content = ThinkingParser.stripThinkingBlocks(content)
        content = ArtifactParser.stripArtifactBlocks(content)
      }
      lines.append("**\(label):**\n\(content)")
    }
    return lines.joined(separator: "\n\n")
  }

  func forkSession(messageId: String?, title: String?) async -> ChatSessionDetail? {
    guard let api else { return nil }
    return try? await api.forkSession(id: sessionId, messageId: messageId, model: sessionModel, title: title)
  }

  func retryFromLastUser() async -> ChatSessionDetail? {
    let lastUser = messages.last(where: { $0.role == "user" })
    let retryTitle = title.isEmpty ? "Retry" : "\(title) (Retry)"
    return await forkSession(messageId: lastUser?.id, title: retryTitle)
  }

  func refreshUsageSnapshot() {
    let promptTokens = messages.compactMap { $0.requestPromptTokens }.reduce(0, +)
    let toolTokens = messages.compactMap { $0.requestToolsTokens }.reduce(0, +)
    let completionTokens = messages.compactMap { $0.requestCompletionTokens }.reduce(0, +)
    let totalInput = messages.compactMap { $0.requestTotalInputTokens }.reduce(0, +)
    let inputTokens = totalInput > 0 ? totalInput : promptTokens + toolTokens
    let totalTokens = inputTokens + completionTokens
    guard totalTokens > 0 else { return }
    chatUsage = ChatUsage(promptTokens: promptTokens + toolTokens, completionTokens: completionTokens, totalTokens: totalTokens)
  }

  private func fetchModels(api: ApiClient) async -> [OpenAIModelInfo] {
    guard let list = try? await api.getServedModels() else { return [] }
    return list.data.sorted { left, right in
      if left.active == true && right.active != true { return true }
      if right.active == true && left.active != true { return false }
      return left.id.localizedCaseInsensitiveCompare(right.id) == .orderedAscending
    }
  }
}
