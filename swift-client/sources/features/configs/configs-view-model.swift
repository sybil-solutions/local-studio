import Foundation

@MainActor
final class ConfigsViewModel: ObservableObject {
  @Published var config: SystemConfigResponse?
  @Published var servers: [McpServer] = []
  @Published var loading = false
  @Published var error: String?

  private var api: ApiClient?

  func connect(api: ApiClient) {
    if self.api == nil { self.api = api }
    Task { await load() }
  }

  func load() async {
    guard let api else { return }
    loading = true
    defer { loading = false }
    do {
      config = try await api.getSystemConfig()
      servers = try await api.getMcpServers()
    } catch { self.error = error.localizedDescription }
  }

  func toggle(server: McpServer) async {
    guard let api else { return }
    _ = try? await api.toggleMcpServer(id: server.id, enabled: !server.enabled)
    await load()
  }

  func delete(server: McpServer) async {
    guard let api else { return }
    _ = try? await api.deleteMcpServer(id: server.id)
    await load()
  }
}
