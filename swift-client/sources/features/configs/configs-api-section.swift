import SwiftUI

struct ConfigsApiSection: View {
  @ObservedObject var settings: SettingsStore

  var body: some View {
    Section("API Settings") {
      TextField("Backend URL", text: $settings.backendUrl)
        .textFieldStyle(.roundedBorder)
      SecureField("API Key", text: $settings.apiKey)
        .textFieldStyle(.roundedBorder)
      Toggle("MCP Enabled", isOn: $settings.mcpEnabled)
      TextField("Voice URL", text: $settings.voiceUrl)
        .textFieldStyle(.roundedBorder)
      TextField("Voice Model", text: $settings.voiceModel)
        .textFieldStyle(.roundedBorder)
    }
  }
}
