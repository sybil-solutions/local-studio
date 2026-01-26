import Foundation

struct UsageModelRow: Codable, Identifiable {
  var id: String { model }
  let model: String
  let requests: Int
  let successful: Int
  let successRate: Double
  let totalTokens: Int
  let promptTokens: Int
  let completionTokens: Int
  let avgTokens: Int
  let avgLatencyMs: Double
  let avgTtftMs: Double
  let tokensPerSec: Double?
}

struct UsageDaily: Codable, Identifiable {
  var id: String { date }
  let date: String
  let requests: Int
  let successful: Int
  let successRate: Double
  let totalTokens: Int
  let promptTokens: Int
  let completionTokens: Int
  let avgLatencyMs: Double
}

struct UsageHourly: Codable, Identifiable {
  var id: Int { hour }
  let hour: Int
  let requests: Int
  let successful: Int
  let tokens: Int
}
