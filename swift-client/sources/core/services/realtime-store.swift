import Foundation

@MainActor
final class RealtimeStore: ObservableObject {
  @Published var status: StatusResponse?
  @Published var gpus: [GpuInfo] = []
  @Published var metrics: Metrics?
  @Published var launchProgress: LaunchProgress?
  @Published var isConnected = false
  @Published var reconnectAttempts = 0

  private var task: Task<Void, Never>?

  func start(api: ApiClient) {
    task?.cancel()
    task = Task { await run(api: api) }
  }

  func stop() {
    task?.cancel()
    task = nil
  }

  private func run(api: ApiClient) async {
    let client = SseClient()
    var attempt = 0
    while !Task.isCancelled {
      do {
        let request = try api.sseRequest(path: "/events")
        isConnected = true
        reconnectAttempts = attempt
        for await event in client.stream(request: request) { handle(event) }
        isConnected = false
        attempt += 1
        try await Task.sleep(nanoseconds: UInt64(min(30, 2 + attempt * 2)) * 1_000_000_000)
      } catch {
        isConnected = false
        attempt += 1
      }
    }
  }
}
