import Foundation

extension ApiClient {
  func getLogSessions() async throws -> LogSessionsResponse {
    try await request("/logs")
  }

  func getLogs(sessionId: String, limit: Int = 2000) async throws -> LogContentResponse {
    try await request("/logs/\(sessionId)?limit=\(limit)")
  }

  func deleteLog(sessionId: String) async throws {
    try await requestVoid("/logs/\(sessionId)", method: "DELETE")
  }
}
