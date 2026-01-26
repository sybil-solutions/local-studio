import Foundation

enum ApiError: Error, LocalizedError {
  case invalidUrl
  case badStatus(Int)
  case emptyResponse

  var errorDescription: String? {
    switch self {
    case .invalidUrl: return "Invalid URL"
    case .badStatus(let code): return "Request failed: \(code)"
    case .emptyResponse: return "Empty response"
    }
  }
}
