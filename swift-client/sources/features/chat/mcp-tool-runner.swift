import Foundation

struct McpToolRunner {
  let api: ApiClient

  func run(calls: [ToolCall]) async -> [StoredMessage] {
    var results: [StoredMessage] = []
    for call in calls {
      let parts = call.function.name.split(separator: "__", maxSplits: 1)
      let server = String(parts.first ?? "")
      let tool = parts.dropFirst().first.map(String.init) ?? call.function.name
      let args = parseArgs(call.function.arguments)
      do {
        let response = try await api.callMcpTool(serverId: server, toolName: tool, args: args)
        let content = formatResult(response.result)
        results.append(StoredMessage(id: UUID().uuidString, role: "tool", content: content, model: nil, toolCalls: nil, toolCallId: call.id))
      } catch {
        let content = "MCP error: \(error.localizedDescription)"
        results.append(StoredMessage(id: UUID().uuidString, role: "tool", content: content, model: nil, toolCalls: nil, toolCallId: call.id))
      }
    }
    return results
  }

  private func parseArgs(_ raw: String) -> [String: Any] {
    guard let data = raw.data(using: .utf8) else { return [:] }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return json
  }

  private func formatResult(_ result: AnyCodable?) -> String {
    switch result {
    case .string(let value): return value
    case .int(let value): return String(value)
    case .double(let value): return String(value)
    case .bool(let value): return String(value)
    case .object(let value): return encodeJson(value)
    case .array(let value): return encodeJson(["result": .array(value)])
    case .null, .none: return ""
    }
  }
}
