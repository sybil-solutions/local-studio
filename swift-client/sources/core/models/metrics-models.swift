import Foundation

struct Metrics: Codable {
  let requestsTotal: Double?
  let tokensTotal: Double?
  let latencyAvg: Double?
  let throughput: Double?
  let gpuUtilization: Double?
  let memoryUsed: Double?
  let avgTtftMs: Double?
  let kvCacheUsage: Double?
  let generationThroughput: Double?
  let promptThroughput: Double?
  let runningRequests: Double?
  let pendingRequests: Double?
}
