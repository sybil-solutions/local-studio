import Foundation

struct ToolCall {
    let id: String
    let type: String
    let function: FunctionCall
}

struct FunctionCall {
    let name: String
    let arguments: String
}

struct AgentMeta {
    var thinkingBlocks: [String]
    var toolCalls: [ToolCall]
    var toolResults: [String]
}

struct ChatAgentActions: Identifiable {
    let id: String
    let title: String
    let meta: AgentMeta
    let startedAt: Date?
    let isStreaming: Bool
}
