import Foundation

extension ChatDetailViewModel {
  func toolDef(for tool: McpTool) -> ToolDefinition {
    let schemaValue = tool.inputSchema?.anyValue
    let params = AnyEncodable(schemaValue as? [String: Any] ?? ["type": "object"])
    let name = "\(tool.server)__\(tool.name)"
    return ToolDefinition(type: "function", function: ToolSpec(name: name, description: tool.description, parameters: params))
  }
}
