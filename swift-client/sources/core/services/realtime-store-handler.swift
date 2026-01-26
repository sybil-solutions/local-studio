import Foundation

extension RealtimeStore {
  func handle(_ event: SseEvent) {
    guard let data = event.data.data(using: .utf8) else { return }
    switch event.event {
    case "status":
      if let payload = try? ApiCodec.decoder.decode(SseEnvelope<StatusResponse>.self, from: data) {
        status = payload.data
      }
    case "gpu":
      if let payload = try? ApiCodec.decoder.decode(SseEnvelope<GpuResponse>.self, from: data) {
        gpus = payload.data.gpus
      }
    case "metrics":
      if let payload = try? ApiCodec.decoder.decode(SseEnvelope<Metrics>.self, from: data) {
        metrics = payload.data
      }
    case "launch_progress":
      if let payload = try? ApiCodec.decoder.decode(SseEnvelope<LaunchProgress>.self, from: data) {
        launchProgress = payload.data
      }
    default:
      break
    }
  }
}
