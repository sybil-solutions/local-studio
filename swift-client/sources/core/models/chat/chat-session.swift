import Foundation

struct ChatSession: Codable, Identifiable {
  let id: String
  let title: String
  let model: String?
  let parentId: String?
  let createdAt: String
  let updatedAt: String
}

struct ChatSessionDetail: Codable {
  let id: String
  let title: String
  let model: String?
  let parentId: String?
  let messages: [StoredMessage]
}

struct ChatSessionResponse: Codable {
  let session: ChatSessionDetail
}

struct ChatSessionCreate: Codable {
  let title: String
  let model: String?
}

struct ChatSessionUpdate: Codable {
  let title: String?
  let model: String?
}

struct ChatSessionFork: Codable {
  let messageId: String?
  let model: String?
  let title: String?
}
