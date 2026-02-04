// CRITICAL
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
  let runtime: SystemRuntimeInfo?
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
  let llamaBin: String?
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

struct RuntimeCudaInfo: Codable {
  let driverVersion: String?
  let cudaVersion: String?
}

struct RuntimeGpuSummary: Codable {
  let count: Int
  let types: [String]
}

struct RuntimeBackendInfo: Codable {
  let installed: Bool
  let version: String?
  let pythonPath: String?
  let binaryPath: String?
}

struct RuntimeBackendsInfo: Codable {
  let vllm: RuntimeBackendInfo
  let sglang: RuntimeBackendInfo
  let llamacpp: RuntimeBackendInfo
}

struct SystemRuntimeInfo: Codable {
  let cuda: RuntimeCudaInfo
  let gpus: RuntimeGpuSummary
  let backends: RuntimeBackendsInfo
}
