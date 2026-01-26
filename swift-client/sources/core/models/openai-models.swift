import Foundation

struct OpenAIModelList: Codable {
  let data: [OpenAIModelInfo]
}

struct OpenAIModelInfo: Codable, Identifiable {
  let id: String
  let object: String?
  let ownedBy: String?
  let active: Bool?
}
