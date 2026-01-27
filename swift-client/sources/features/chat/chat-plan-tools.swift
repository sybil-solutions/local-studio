import Foundation

// MARK: - Plan Task Model

struct PlanTask: Identifiable, Codable {
  let id: String
  let title: String
  var status: Status

  enum Status: String, Codable {
    case pending, inProgress = "in_progress", done
  }
}

// MARK: - Tool Definitions

enum PlanTools {
  static let names: Set<String> = ["create_plan", "update_plan"]

  static let createPlan = ToolDefinition(
    type: "function",
    function: ToolSpec(
      name: "create_plan",
      description: "Create a structured plan with tasks. Call this before starting complex work.",
      parameters: AnyEncodable([
        "type": "object",
        "properties": [
          "tasks": [
            "type": "array",
            "items": [
              "type": "object",
              "properties": [
                "id": ["type": "string", "description": "Unique task id"],
                "title": ["type": "string", "description": "Short task description"],
              ],
              "required": ["id", "title"],
            ],
            "description": "List of tasks in execution order",
          ]
        ],
        "required": ["tasks"],
      ] as [String: Any])
    )
  )

  static let updatePlan = ToolDefinition(
    type: "function",
    function: ToolSpec(
      name: "update_plan",
      description: "Update the status of a plan task. Call after completing each task.",
      parameters: AnyEncodable([
        "type": "object",
        "properties": [
          "task_id": ["type": "string", "description": "The task id to update"],
          "status": ["type": "string", "enum": ["in_progress", "done"], "description": "New status"],
        ],
        "required": ["task_id", "status"],
      ] as [String: Any])
    )
  )

  static var definitions: [ToolDefinition] { [createPlan, updatePlan] }
}

// MARK: - Plan Tool Handler

enum PlanToolHandler {
  struct Result {
    let plan: [PlanTask]
    let resultContent: String
  }

  static func handle(call: ToolCall, currentPlan: [PlanTask]?) -> Result {
    let args = parseArgs(call.function.arguments)

    switch call.function.name {
    case "create_plan":
      let rawTasks = args["tasks"] as? [[String: Any]] ?? []
      let tasks = rawTasks.map { dict in
        PlanTask(
          id: dict["id"] as? String ?? UUID().uuidString,
          title: dict["title"] as? String ?? "Untitled",
          status: .pending
        )
      }
      let summary = tasks.map { "- [ ] \($0.title)" }.joined(separator: "\n")
      return Result(plan: tasks, resultContent: "Plan created with \(tasks.count) tasks:\n\(summary)")

    case "update_plan":
      let taskId = args["task_id"] as? String ?? ""
      let statusStr = args["status"] as? String ?? "done"
      let newStatus = PlanTask.Status(rawValue: statusStr) ?? .done
      var plan = currentPlan ?? []
      if let idx = plan.firstIndex(where: { $0.id == taskId }) {
        plan[idx].status = newStatus
        let label = newStatus == .done ? "completed" : "in progress"
        return Result(plan: plan, resultContent: "Task '\(plan[idx].title)' marked as \(label).")
      }
      return Result(plan: plan, resultContent: "Task '\(taskId)' not found in plan.")

    default:
      return Result(plan: currentPlan ?? [], resultContent: "Unknown plan tool: \(call.function.name)")
    }
  }

  static func promptSection(_ plan: [PlanTask]?) -> String? {
    guard let tasks = plan.nilIfEmpty else { return nil }
    var lines = ["\n\n## Current Plan"]
    for task in tasks {
      let icon: String
      switch task.status {
      case .pending: icon = "[ ]"
      case .inProgress: icon = "[~]"
      case .done: icon = "[x]"
      }
      lines.append("- \(icon) \(task.id): \(task.title)")
    }
    let hasPending = tasks.contains { $0.status != .done }
    if hasPending {
      lines.append("\nCall update_plan to mark each task as you complete it.")
    }
    return lines.joined(separator: "\n")
  }

  private static func parseArgs(_ raw: String) -> [String: Any] {
    guard let data = raw.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    return json
  }
}

// MARK: - Helpers

extension Optional where Wrapped: Collection {
  var nilIfEmpty: Wrapped? {
    switch self {
    case .some(let value): return value.isEmpty ? nil : value
    case .none: return nil
    }
  }
}
