import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
  @Published var recipes: [RecipeWithStatus] = []
  @Published var loading = false
  @Published var error: String?
  @Published var benchmark: BenchmarkResult?
  @Published var logSession: LogSession?
  @Published var logLines: [String] = []

  private var api: ApiClient?

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do {
      recipes = try await api.getRecipes()
      let sessions = try await api.getLogSessions().sessions
      logSession = sessions.first
      if let session = logSession {
        let logs = try await api.getLogs(sessionId: session.id, limit: 200)
        logLines = logs.logs ?? logs.content?.split(separator: "\n").map(String.init) ?? []
      }
    } catch { self.error = error.localizedDescription }
  }

  func launch(recipeId: String) async {
    guard let api else { return }
    _ = try? await api.launchRecipe(id: recipeId)
  }

  func evict() async {
    guard let api else { return }
    _ = try? await api.evict(force: true)
  }

  func benchmark(prompt: Int, max: Int) async {
    guard let api else { return }
    benchmark = try? await api.runBenchmark(promptTokens: prompt, maxTokens: max)
  }
}
