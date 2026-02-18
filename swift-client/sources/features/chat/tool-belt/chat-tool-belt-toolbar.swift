// CRITICAL
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
    HStack(spacing: 10) {
      Menu {
        Button(action: onAddFile) { Label("Attach File", systemImage: "paperclip") }
        Button(action: onAddImage) { Label("Add Image", systemImage: "photo") }
        Button(action: onRecord) { Label(isRecording ? "Stop Recording" : "Record Audio", systemImage: isRecording ? "stop.circle" : "mic") }
      } label: {
        CircleIcon(systemName: "plus")
      }

      if !models.isEmpty {
        Menu {
          ForEach(models) { m in
            Button(action: { onModelChange(m.id) }) {
              HStack {
                Text(m.id)
                if m.id == selectedModel { Image(systemName: "checkmark") }
              }
            }
          }
        } label: {
          HStack(spacing: 6) {
            Text(selectedModel ?? "Select model")
              .lineLimit(1)
              .truncationMode(.middle)
            Image(systemName: "chevron.down")
              .font(.system(size: 10, weight: .semibold))
              .foregroundColor(AppTheme.muted)
          }
          .font(AppTheme.captionFont.weight(.semibold))
          .foregroundColor(AppTheme.muted)
          .padding(.horizontal, 10)
          .frame(height: 28)
           .background(Color.clear)
          .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.border))
          .clipShape(RoundedRectangle(cornerRadius: 10))
        }
      }

      Menu {
        Button(action: onMcpToggle) { Label(mcpEnabled ? "Web search & tools: On" : "Web search & tools: Off", systemImage: "globe") }
        Button(action: onDeepResearchToggle) { Label(deepResearchEnabled ? "Deep Research: On" : "Deep Research: Off", systemImage: "brain") }
        Button(action: onPlanModeToggle) { Label(planModeEnabled ? "Planning: On" : "Planning: Off", systemImage: "list.bullet.clipboard") }
        Button(action: onShowTools) { Label("Tools", systemImage: "wrench") }
      } label: {
        CircleIcon(systemName: "slider.horizontal.3")
      }

      Spacer(minLength: 0)
    }
  }
}

private struct CircleIcon: View {
  let systemName: String

  var body: some View {
      Image(systemName: systemName)
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(AppTheme.muted)
        .frame(width: 28, height: 28)
        .background(AppTheme.foreground.opacity(0.04))
        .overlay(Circle().stroke(AppTheme.border))
        .clipShape(Circle())
  }
}
