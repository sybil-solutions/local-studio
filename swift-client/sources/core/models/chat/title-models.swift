import Foundation

struct TitleRequest: Encodable {
  let model: String?
  let user: String
  let assistant: String
}

struct TitleResponse: Decodable {
  let title: String
}
