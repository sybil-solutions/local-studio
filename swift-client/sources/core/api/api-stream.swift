import Foundation

extension ApiClient {
  func sseRequest(path: String) throws -> URLRequest {
    try buildRequest(path, method: "GET", body: nil)
  }
}
