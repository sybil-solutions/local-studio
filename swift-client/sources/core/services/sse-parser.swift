import Foundation

struct SseParser {
  private var buffer = ""
  private var currentEvent = "message"
  private var currentData = ""

  mutating func ingest(_ chunk: String) -> [SseEvent] {
    buffer += chunk
    var events: [SseEvent] = []
    while let range = buffer.range(of: "\n") {
      // Normalize CRLF (\r\n) so blank lines terminate events correctly.
      // Some servers send event separators as "\r\n\r\n" which otherwise produces a
      // line containing only "\r" when consuming via `bytes.lines`.
      let line = String(buffer[..<range.lowerBound]).trimmingCharacters(in: .newlines)
      buffer.removeSubrange(..<range.upperBound)
      if line.isEmpty {
        if !currentData.isEmpty {
          events.append(SseEvent(event: currentEvent, data: currentData.trimmingCharacters(in: .newlines)))
        }
        currentEvent = "message"
        currentData = ""
        continue
      }
      if line.hasPrefix("event:") {
        currentEvent = line.replacingOccurrences(of: "event:", with: "").trimmingCharacters(in: .whitespaces)
      } else if line.hasPrefix("data:") {
        let value = line.replacingOccurrences(of: "data:", with: "").trimmingCharacters(in: .whitespaces)
        currentData += value + "\n"
      }
    }
    return events
  }
}
