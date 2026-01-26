import Foundation

struct UsageStats: Codable {
  let totals: UsageTotals
  let latency: UsageLatency
  let ttft: UsageLatency
  let tokensPerRequest: TokensPerRequest
  let cache: UsageCache
  let byModel: [UsageModelRow]
  let daily: [UsageDaily]
  let hourlyPattern: [UsageHourly]
}

struct UsageTotals: Codable {
  let totalTokens: Int
  let promptTokens: Int
  let completionTokens: Int
  let totalRequests: Int
  let successfulRequests: Int
  let failedRequests: Int
  let successRate: Double
  let uniqueSessions: Int
  let uniqueUsers: Int
}

struct UsageLatency: Codable {
  let avgMs: Double
  let p50Ms: Double
  let p95Ms: Double
  let p99Ms: Double
  let minMs: Double?
  let maxMs: Double?
}

struct TokensPerRequest: Codable {
  let avg: Double
  let avgPrompt: Double
  let avgCompletion: Double
  let max: Double
  let p50: Double
  let p95: Double
}

struct UsageCache: Codable {
  let hits: Int
  let misses: Int
  let hitTokens: Int
  let missTokens: Int
  let hitRate: Double
}
