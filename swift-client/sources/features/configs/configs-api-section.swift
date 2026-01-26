import SwiftUI

struct ConfigsApiSection: View {
  @ObservedObject var settings: SettingsStore

  var body: some View {
    Section("API Settings") {
      TextField("Backend URL", text: $settings.backendUrl)
      SecureField("API Key", text: $settings.apiKey)
      Toggle("MCP Enabled", isOn: $settings.mcpEnabled)
      TextField("Voice URL", text: $settings.voiceUrl)
      TextField("Voice Model", text: $settings.voiceModel)
    }
  }
}
