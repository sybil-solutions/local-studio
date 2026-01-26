import Foundation

@MainActor
final class DashboardViewModel: ObservableObject {
  @Published var recipes: [RecipeWithStatus] = []
  @Published var loading = false
  @Published var error: String?
  @Published var benchmark: BenchmarkResult?

  private var api: ApiClient?

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do { recipes = try await api.getRecipes() }
    catch { self.error = error.localizedDescription }
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
