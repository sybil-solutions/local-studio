import Foundation

struct Metrics: Codable {
  let lifetimePromptTokens: Double?
  let lifetimeCompletionTokens: Double?
  let lifetimeRequests: Double?
  let lifetimeEnergyKwh: Double?
  let lifetimeUptimeHours: Double?
  let currentPowerWatts: Double?
  let kwhPerMillionInput: Double?
  let kwhPerMillionOutput: Double?
  let promptTokensTotal: Double?
  let generationTokensTotal: Double?
  let promptThroughput: Double?
  let generationThroughput: Double?
  let runningRequests: Double?
  let pendingRequests: Double?
  let kvCacheUsage: Double?
  let peakPrefillTps: Double?
  let peakGenerationTps: Double?
  let peakTtftMs: Double?
}
