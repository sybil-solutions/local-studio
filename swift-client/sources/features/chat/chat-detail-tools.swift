import Foundation

extension ChatDetailViewModel {
  func toolDef(for tool: McpTool) -> ToolDefinition {
    let params = AnyEncodable(["type": "object"])
    let name = "\(tool.server)__\(tool.name)"
    return ToolDefinition(type: "function", function: ToolSpec(name: name, description: tool.description, parameters: params))
  }
}
