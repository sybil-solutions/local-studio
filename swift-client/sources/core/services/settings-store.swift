import Foundation

final class SettingsStore: ObservableObject {
  @Published var backendUrl: String { didSet { save() } }
  @Published var apiKey: String { didSet { save() } }
  @Published var voiceUrl: String { didSet { save() } }
  @Published var voiceModel: String { didSet { save() } }
  @Published var mcpEnabled: Bool { didSet { save() } }
  @Published var planModeEnabled: Bool { didSet { save() } }

  init() {
    let defaults = UserDefaults.standard
    backendUrl = defaults.string(forKey: "backend-url") ?? "http://localhost:8080"
    apiKey = defaults.string(forKey: "api-key") ?? ""
    voiceUrl = defaults.string(forKey: "voice-url") ?? "https://voice.homelabai.org"
    voiceModel = defaults.string(forKey: "voice-model") ?? "whisper-large-v3-turbo"
    mcpEnabled = defaults.object(forKey: "mcp-enabled") as? Bool ?? true
    planModeEnabled = defaults.object(forKey: "plan-mode-enabled") as? Bool ?? false
  }

  func saveNow() {
    save()
  }

  private func save() {
    let defaults = UserDefaults.standard
    defaults.set(backendUrl, forKey: "backend-url")
    defaults.set(apiKey, forKey: "api-key")
    defaults.set(voiceUrl, forKey: "voice-url")
    defaults.set(voiceModel, forKey: "voice-model")
    defaults.set(mcpEnabled, forKey: "mcp-enabled")
    defaults.set(planModeEnabled, forKey: "plan-mode-enabled")
  }
}
