import SwiftUI

struct ConfigsMcpSection: View {
  let servers: [McpServer]
  let onToggle: (McpServer) -> Void
  let onDelete: (IndexSet) -> Void

  var body: some View {
    Section("MCP Servers") {
      ForEach(servers) { server in
        HStack {
          NavigationLink(server.name) { McpServerEditorView(server: server) }
          Spacer()
          Toggle("", isOn: Binding(
            get: { server.enabled },
            set: { _ in onToggle(server) }
          ))
          .labelsHidden()
        }
      }
      .onDelete(perform: onDelete)
    }
  }
}
