import Foundation

struct McpToolRunner {
  let api: ApiClient

  func run(calls: [ToolCall]) async -> [StoredMessage] {
    var results: [StoredMessage] = []
    for call in calls {
      let parts = call.function.name.split(separator: "__", maxSplits: 1)
      let server = String(parts.first ?? "")
      let tool = String(parts.dropFirst().first ?? call.function.name)
      let args = parseArgs(call.function.arguments)
      let response = try? await api.callMcpTool(serverId: server, toolName: tool, args: args)
      let content = response?.result ?? ""
      results.append(StoredMessage(id: UUID().uuidString, role: "tool", content: content, model: nil, toolCalls: nil, toolCallId: call.id))
    }
    return results
  }

  private func parseArgs(_ raw: String) -> [String: String] {
    guard let data = raw.data(using: .utf8) else { return [:] }
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return json.mapValues { String(describing: $0) }
  }
}
