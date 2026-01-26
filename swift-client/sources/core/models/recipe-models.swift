// CRITICAL
import Foundation

struct Recipe: Codable, Identifiable {
  let id: String
  let name: String
  let modelPath: String
  let backend: String?
  let host: String?
  let port: Int?
  let servedModelName: String?
  let trustRemoteCode: Bool?
  let dtype: String?
  let quantization: String?
  let tensorParallelSize: Int?
  let pipelineParallelSize: Int?
  let gpuMemoryUtilization: Double?
  let maxModelLen: Int?
  let kvCacheDtype: String?
  let maxNumSeqs: Int?
  let toolCallParser: String?
  let reasoningParser: String?
  let enableAutoToolChoice: Bool?
  let extraArgs: [String: AnyCodable]?
  let maxThinkingTokens: Int?
  let thinkingMode: String?
}

struct RecipeWithStatus: Codable, Identifiable {
  let id: String
  let name: String
  let modelPath: String
  let backend: String?
  let status: String
  let host: String?
  let port: Int?
  let servedModelName: String?
  let trustRemoteCode: Bool?
  let dtype: String?
  let quantization: String?
  let tensorParallelSize: Int?
  let pipelineParallelSize: Int?
  let gpuMemoryUtilization: Double?
  let maxModelLen: Int?
  let kvCacheDtype: String?
  let maxNumSeqs: Int?
  let toolCallParser: String?
  let reasoningParser: String?
  let enableAutoToolChoice: Bool?
  let extraArgs: [String: AnyCodable]?
  let maxThinkingTokens: Int?
  let thinkingMode: String?
}

struct LaunchResult: Codable {
  let success: Bool
  let pid: Int?
  let message: String
  let logFile: String?
}

struct LaunchProgress: Codable {
  let recipeId: String?
  let stage: String
  let message: String
  let progress: Double?
}

struct BenchmarkResult: Codable {
  let success: Bool?
  let error: String?
  let modelId: String?
  let benchmark: BenchmarkStats?
}

struct BenchmarkStats: Codable {
  let promptTokens: Int
  let completionTokens: Int
  let totalTimeS: Double
  let prefillTps: Double
  let generationTps: Double
  let ttftMs: Double
}
