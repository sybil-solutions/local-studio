import Foundation

final class ApiClient {
  private let settings: SettingsStore
  private let session: URLSession

  init(settings: SettingsStore, session: URLSession = .shared) {
    self.settings = settings
    self.session = session
  }

  func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
    let (data, response) = try await session.data(for: try buildRequest(path, method: method, body: body))
    guard let http = response as? HTTPURLResponse else { throw ApiError.badStatus(-1) }
    guard (200..<300).contains(http.statusCode) else { throw ApiError.badStatus(http.statusCode) }
    if data.isEmpty { throw ApiError.emptyResponse }
    return try ApiCodec.decoder.decode(T.self, from: data)
  }

  func requestData(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
    let (data, response) = try await session.data(for: try buildRequest(path, method: method, body: body))
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      throw ApiError.badStatus((response as? HTTPURLResponse)?.statusCode ?? -1)
    }
    return data
  }

  func requestVoid(_ path: String, method: String = "POST", body: Data? = nil) async throws {
    _ = try await requestData(path, method: method, body: body)
  }

  func buildRequest(_ path: String, method: String, body: Data?) throws -> URLRequest {
    guard let base = URL(string: settings.backendUrl) else { throw ApiError.invalidUrl }
    guard let url = URL(string: path, relativeTo: base) else { throw ApiError.invalidUrl }
    var request = URLRequest(url: url)
    request.httpMethod = method
    if let body { request.httpBody = body }
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if !settings.apiKey.isEmpty {
      request.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
    }
    return request
  }
}
