import Foundation

@MainActor
final class LogsViewModel: ObservableObject {
  @Published var sessions: [LogSession] = []
  @Published var selectedId: String?
  @Published var lines: [String] = []

  private var api: ApiClient?

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    sessions = (try? await api.getLogSessions().sessions) ?? []
    selectedId = sessions.first?.id
    await loadSelected()
  }

  func loadSelected() async {
    guard let api, let selected = selectedSession else { return }
    let logs = try? await api.getLogs(sessionId: selected.id, limit: 500)
    lines = logs?.logs ?? logs?.content?.split(separator: "\n").map(String.init) ?? []
  }

  var selectedSession: LogSession? {
    sessions.first { $0.id == selectedId }
  }
}
