import Foundation

@MainActor
final class DiscoverViewModel: ObservableObject {
  @Published var models: [HfModel] = []
  @Published var localModels: [StudioModelInfo] = []
  @Published var search = ""
  @Published var task = "text-generation"
  @Published var sort = "trending"
  @Published var loading = false
  @Published var error: String?
  @Published var hasMore = true

  private var api: ApiClient?
  private var page = 0
  private let pageSize = 50

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do {
      localModels = try await api.getStudioModels().models
      page = 0
      models = try await api.getHuggingFaceModels(query(reset: true))
      hasMore = models.count == pageSize
    } catch { self.error = error.localizedDescription }
  }

  func loadMore() async {
    guard let api, hasMore, !loading else { return }
    loading = true
    defer { loading = false }
    page += 1
    let more = (try? await api.getHuggingFaceModels(query(reset: false))) ?? []
    models += more
    hasMore = more.count == pageSize
  }

  private func query(reset: Bool) -> HfQuery {
    HfQuery(search: search, filter: task, sort: sort, limit: pageSize, offset: reset ? 0 : page * pageSize)
  }
}
