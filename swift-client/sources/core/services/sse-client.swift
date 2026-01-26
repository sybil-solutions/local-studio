import Foundation

final class SseClient {
  func stream(request: URLRequest) -> AsyncStream<SseEvent> {
    AsyncStream { continuation in
      Task {
        do {
          let (bytes, _) = try await URLSession.shared.bytes(for: request)
          var parser = SseParser()
          for try await line in bytes.lines {
            let events = parser.ingest(line + "\n")
            events.forEach { continuation.yield($0) }
          }
          continuation.finish()
        } catch {
          continuation.finish()
        }
      }
    }
  }
}
