import Foundation

struct SseEnvelope<T: Decodable>: Decodable {
  let data: T
  let timestamp: String
}
