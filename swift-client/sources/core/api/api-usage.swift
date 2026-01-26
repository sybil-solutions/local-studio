import Foundation

extension ApiClient {
  func getUsageStats() async throws -> UsageStats {
    try await request("/usage")
  }
}
