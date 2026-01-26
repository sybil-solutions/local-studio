import Foundation

extension ApiClient {
  func getChatSessions() async throws -> [ChatSession] {
    try await request("/chats")
  }

  func getChatSession(id: String) async throws -> ChatSessionDetail {
    let response: ChatSessionResponse = try await request("/chats/\(id)")
    return response.session
  }

  func createChatSession(title: String, model: String?) async throws -> ChatSessionDetail {
    let payload = ChatSessionCreate(title: title, model: model)
    let data = try ApiCodec.encoder.encode(payload)
    let response: ChatSessionResponse = try await request("/chats", method: "POST", body: data)
    return response.session
  }

  func updateChatSession(id: String, title: String?, model: String?) async throws {
    let payload = ChatSessionUpdate(title: title, model: model)
    let data = try ApiCodec.encoder.encode(payload)
    try await requestVoid("/chats/\(id)", method: "PUT", body: data)
  }

  func deleteChatSession(id: String) async throws {
    try await requestVoid("/chats/\(id)", method: "DELETE")
  }

  func addMessage(sessionId: String, message: StoredMessage) async throws -> StoredMessage {
    let data = try ApiCodec.encoder.encode(message)
    return try await request("/chats/\(sessionId)/messages", method: "POST", body: data)
  }

  func getChatUsage(sessionId: String) async throws -> ChatUsage {
    try await request("/chats/\(sessionId)/usage")
  }

  func forkSession(id: String, messageId: String?, model: String?, title: String?) async throws -> ChatSessionDetail {
    let payload = ChatSessionFork(messageId: messageId, model: model, title: title)
    let data = try ApiCodec.encoder.encode(payload)
    let response: ChatSessionResponse = try await request("/chats/\(id)/fork", method: "POST", body: data)
    return response.session
  }
}
