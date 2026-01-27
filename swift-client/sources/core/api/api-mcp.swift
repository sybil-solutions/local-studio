import Foundation

extension ApiClient {
  func getMcpServers() async throws -> [McpServer] {
    try await request("/mcp/servers")
  }

  func getMcpTools() async throws -> McpToolsResponse {
    try await request("/mcp/tools")
  }

  func saveMcpServer(_ server: McpServer) async throws {
    let data = try ApiCodec.encoder.encode(server)
    if server.id.isEmpty {
      try await requestVoid("/mcp/servers", method: "POST", body: data)
    } else {
      try await requestVoid("/mcp/servers/\(server.id)", method: "PUT", body: data)
    }
  }

  func toggleMcpServer(id: String, enabled: Bool) async throws {
    let path = enabled ? "/mcp/servers/\(id)/enable" : "/mcp/servers/\(id)/disable"
    try await requestVoid(path, method: "POST")
  }

  func deleteMcpServer(id: String) async throws {
    try await requestVoid("/mcp/servers/\(id)", method: "DELETE")
  }

  func callMcpTool(serverId: String, toolName: String, args: [String: Any]) async throws -> McpToolResult {
    let data = try ApiCodec.encoder.encode(AnyEncodable(args))
    return try await request("/mcp/tools/\(serverId)/\(toolName)", method: "POST", body: data)
  }
}
