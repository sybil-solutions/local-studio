import Foundation

extension ApiClient {
  func getRecipes() async throws -> [RecipeWithStatus] {
    try await request("/recipes")
  }

  func getRecipe(id: String) async throws -> Recipe {
    try await request("/recipes/\(id)")
  }

  func createRecipe(_ recipe: Recipe) async throws {
    let data = try ApiCodec.encoder.encode(recipe)
    try await requestVoid("/recipes", method: "POST", body: data)
  }

  func updateRecipe(_ recipe: Recipe) async throws {
    let data = try ApiCodec.encoder.encode(recipe)
    try await requestVoid("/recipes/\(recipe.id)", method: "PUT", body: data)
  }

  func deleteRecipe(id: String) async throws {
    try await requestVoid("/recipes/\(id)", method: "DELETE")
  }

  func launchRecipe(id: String) async throws -> LaunchResult {
    try await request("/launch/\(id)", method: "POST")
  }

  func cancelLaunch(id: String) async throws {
    try await requestVoid("/launch/\(id)/cancel", method: "POST")
  }

  func evict(force: Bool) async throws {
    try await requestVoid("/evict?force=\(force)", method: "POST")
  }

  func runBenchmark(promptTokens: Int, maxTokens: Int) async throws -> BenchmarkResult {
    try await request("/benchmark?prompt_tokens=\(promptTokens)&max_tokens=\(maxTokens)", method: "POST")
  }
}
