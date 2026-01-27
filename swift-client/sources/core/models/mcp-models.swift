import Foundation

struct McpServer: Codable, Identifiable {
  var id: String
  var name: String
  var enabled: Bool
  var command: String
  var args: [String]
  var env: [String: String]
  var description: String?
  var url: String?
}

struct McpTool: Codable, Identifiable {
  var id: String { name + ":" + server }
  let name: String
  let description: String?
  let inputSchema: AnyCodable?
  let server: String
}

struct McpToolsResponse: Codable {
  let tools: [McpTool]
  let errors: [McpToolError]?
}

struct McpToolError: Codable {
  let server: String
  let error: String
}

struct McpToolResult: Codable {
  let result: AnyCodable?
}
