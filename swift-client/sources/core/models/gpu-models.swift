import Foundation

struct GpuResponse: Codable {
  let count: Int
  let gpus: [GpuInfo]
}

struct GpuInfo: Codable, Identifiable {
  var id: Int { index }
  let index: Int
  let name: String
  let memoryTotal: Double
  let memoryUsed: Double
  let memoryFree: Double
  let utilization: Double
  let temperature: Double?
  let powerDraw: Double?
  let powerLimit: Double?
}
