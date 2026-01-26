import SwiftUI

struct ConfigsView: View {
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ConfigsViewModel()
  @State private var showAdd = false

  var body: some View {
    Form {
      ConfigsApiSection(settings: container.settings)
      ConfigsServicesSection(services: model.config?.services)
      ConfigsMcpSection(servers: model.servers, onToggle: { server in
        Task { await model.toggle(server: server) }
      }, onDelete: { indexSet in
        Task { for index in indexSet { await model.delete(server: model.servers[index]) } }
      })
    }
    .navigationTitle("Configs")
    .toolbar { Button("Add Server") { showAdd = true } }
    .sheet(isPresented: $showAdd) {
      NavigationStack { McpServerEditorView(server: McpServer(id: "", name: "", enabled: true, command: "", args: [], env: [:], description: nil, url: nil)) }
    }
    .onAppear { model.connect(api: container.api) }
  }
}
