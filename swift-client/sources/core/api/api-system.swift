import Foundation

extension ApiClient {
  func getHealth() async throws -> HealthResponse {
    try await request("/health")
  }

  func getStatus() async throws -> StatusResponse {
    try await request("/status")
  }

  func getGpus() async throws -> GpuResponse {
    try await request("/gpus")
  }

  func getSystemConfig() async throws -> SystemConfigResponse {
    try await request("/config")
  }
}
