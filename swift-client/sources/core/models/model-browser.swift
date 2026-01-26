import Foundation

struct StudioModelsResponse: Codable {
  let models: [StudioModelInfo]
  let roots: [StudioRoot]?
  let configuredModelsDir: String?
}

struct StudioModelInfo: Codable, Identifiable {
  var id: String { name }
  let name: String
  let path: String
  let format: String?
  let size: Int?
}

struct StudioRoot: Codable, Identifiable {
  var id: String { path }
  let path: String
  let exists: Bool
  let sources: [String]
  let recipeIds: [String]
}

struct HfModel: Codable, Identifiable {
  var id: String { modelId }
  let modelId: String
  let pipelineTag: String?
  let likes: Int?
  let downloads: Int?
  let libraryName: String?
  let lastModified: String?
}

struct HfQuery {
  let search: String
  let filter: String
  let sort: String
  let limit: Int
  let offset: Int
}
