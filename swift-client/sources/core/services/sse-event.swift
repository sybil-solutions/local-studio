import Foundation

struct SseEvent: Equatable {
  let event: String
  let data: String
}
