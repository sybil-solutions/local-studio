import SwiftUI

struct McpServerEditorView: View {
  @EnvironmentObject private var container: AppContainer
  @Environment(\.dismiss) private var dismiss
  @State var server: McpServer
  @State private var envText = "{}"

  var body: some View {
    Form {
      TextField("ID", text: $server.id)
      TextField("Name", text: $server.name)
      TextField("Command", text: $server.command)
      TextField("Args (comma)", text: Binding(
        get: { server.args.joined(separator: ",") },
        set: { server.args = $0.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } }
      ))
      TextField("URL", text: Binding($server.url, ""))
      TextField("Description", text: Binding($server.description, ""))
      TextField("Env JSON", text: $envText)
      Toggle("Enabled", isOn: $server.enabled)
      Button("Save") { Task { await save() } }
    }
    .navigationTitle("MCP Server")
    .onAppear { envText = encodeJson(server.env) }
  }

  private func save() async {
    server.env = decodeJson(envText)
    _ = try? await container.api.saveMcpServer(server)
    dismiss()
  }
}
