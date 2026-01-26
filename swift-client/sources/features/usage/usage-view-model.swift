import Foundation

@MainActor
final class UsageViewModel: ObservableObject {
  @Published var stats: UsageStats?
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
    do { stats = try await api.getUsageStats() }
    catch { self.error = error.localizedDescription }
  }
}
