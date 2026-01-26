import Foundation

extension ApiClient {
  func getStudioModels() async throws -> StudioModelsResponse {
    try await request("/v1/studio/models")
  }

  func getHuggingFaceModels(_ query: HfQuery) async throws -> [HfModel] {
    var parts: [String] = ["limit=\(query.limit)", "full=false", "sort=\(query.sort)", "offset=\(query.offset)"]
    if !query.search.isEmpty { parts.append("search=\(query.search)") }
    if !query.filter.isEmpty { parts.append("filter=\(query.filter)") }
    let path = "/v1/huggingface/models?" + parts.joined(separator: "&")
    return try await request(path)
  }
}
