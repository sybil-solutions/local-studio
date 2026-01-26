import Foundation

final class SettingsStore: ObservableObject {
  @Published var backendUrl: String { didSet { save() } }
  @Published var apiKey: String { didSet { save() } }
  @Published var voiceUrl: String { didSet { save() } }
  @Published var voiceModel: String { didSet { save() } }
  @Published var mcpEnabled: Bool { didSet { save() } }

  init() {
    let defaults = UserDefaults.standard
    backendUrl = defaults.string(forKey: "backend-url") ?? "http://localhost:8080"
    apiKey = defaults.string(forKey: "api-key") ?? ""
    voiceUrl = defaults.string(forKey: "voice-url") ?? ""
    voiceModel = defaults.string(forKey: "voice-model") ?? ""
    mcpEnabled = defaults.bool(forKey: "mcp-enabled")
  }

  private func save() {
    let defaults = UserDefaults.standard
    defaults.set(backendUrl, forKey: "backend-url")
    defaults.set(apiKey, forKey: "api-key")
    defaults.set(voiceUrl, forKey: "voice-url")
    defaults.set(voiceModel, forKey: "voice-model")
    defaults.set(mcpEnabled, forKey: "mcp-enabled")
  }
}
