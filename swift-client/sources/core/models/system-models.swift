import Foundation

struct HealthResponse: Codable {
  let status: String
  let version: String
  let inferenceReady: Bool
  let backendReachable: Bool
  let runningModel: String?
}

struct StatusResponse: Codable {
  let running: Bool
  let process: ProcessInfo?
  let inferencePort: Int
  let launching: String?
}

struct SystemConfigResponse: Codable {
  let config: SystemConfig
  let services: [ServiceInfo]
  let environment: EnvironmentInfo
}

struct SystemConfig: Codable {
  let host: String
  let port: Int
  let inferencePort: Int
  let apiKeyConfigured: Bool
  let modelsDir: String
  let dataDir: String
  let dbPath: String
  let sglangPython: String?
  let tabbyApiDir: String?
}

struct ServiceInfo: Codable {
  let name: String
  let port: Int
  let internalPort: Int
  let protocolType: String
  let status: String
  let description: String?

  enum CodingKeys: String, CodingKey {
    case name, port, internalPort, status, description
    case protocolType = "protocol"
  }
}

struct EnvironmentInfo: Codable {
  let controllerUrl: String
  let inferenceUrl: String
  let litellmUrl: String
  let frontendUrl: String
}
