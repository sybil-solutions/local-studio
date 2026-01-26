import Foundation

extension ApiClient {
  func sseRequest(path: String) throws -> URLRequest {
    var request = try buildRequest(path, method: "GET", body: nil)
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    return request
  }
}
