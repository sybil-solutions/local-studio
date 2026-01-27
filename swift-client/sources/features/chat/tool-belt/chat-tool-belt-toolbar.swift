import SwiftUI

struct ChatToolBeltToolbar: View {
  let models: [OpenAIModelInfo]
  let selectedModel: String?
  let onModelChange: (String) -> Void
  let mcpEnabled: Bool
  let onMcpToggle: () -> Void
  let deepResearchEnabled: Bool
  let onDeepResearchToggle: () -> Void
  let planModeEnabled: Bool
  let onPlanModeToggle: () -> Void
  let isRecording: Bool
  let onAddFile: () -> Void
  let onAddImage: () -> Void
  let onRecord: () -> Void
  let onShowTools: () -> Void

  var body: some View {
    HStack(spacing: 14) {
      Menu {
        Button(action: onAddFile) { Label("Attach File", systemImage: "paperclip") }
        Button(action: onAddImage) { Label("Add Image", systemImage: "photo") }
        Button(action: onRecord) { Label(isRecording ? "Stop" : "Record", systemImage: isRecording ? "stop.circle" : "mic") }
      } label: {
        Image(systemName: "paperclip")
      }
      Menu {
        if models.isEmpty {
          Text("No models loaded")
        } else {
          ForEach(models) { m in
            Button(action: { onModelChange(m.id) }) {
              HStack {
                Text(m.id)
                if m.id == selectedModel { Image(systemName: "checkmark") }
              }
            }
          }
        }
      } label: {
        HStack(spacing: 4) {
          Text(selectedModel ?? "model").lineLimit(1).truncationMode(.middle)
          Image(systemName: "chevron.down").font(.system(size: 8))
        }
      }
      Menu {
        Button(action: onMcpToggle) { Label(mcpEnabled ? "MCP On" : "MCP Off", systemImage: mcpEnabled ? "bolt.fill" : "bolt") }
        Button(action: onDeepResearchToggle) { Label(deepResearchEnabled ? "Deep On" : "Deep Off", systemImage: deepResearchEnabled ? "globe.americas.fill" : "globe") }
        Button(action: onPlanModeToggle) { Label(planModeEnabled ? "Plan On" : "Plan Off", systemImage: planModeEnabled ? "list.bullet.clipboard.fill" : "list.bullet.clipboard") }
        Button(action: onShowTools) { Label("Tools", systemImage: "wrench") }
      } label: {
        Image(systemName: "slider.horizontal.3")
      }
      Spacer()
    }
    .font(AppTheme.captionFont)
    .foregroundColor(AppTheme.muted)
  }
}
