import Foundation

struct LogSessionsResponse: Codable {
  let sessions: [LogSession]
}

struct LogSession: Codable, Identifiable {
  let id: String
  let recipeId: String?
  let recipeName: String?
  let model: String?
  let backend: String?
  let createdAt: String
  let status: String
}

struct LogContentResponse: Codable {
  let id: String
  let logs: [String]?
  let content: String?
}
