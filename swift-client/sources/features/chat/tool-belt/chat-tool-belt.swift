// CRITICAL
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
struct ChatToolBelt: View {
  @Binding var text: String
  @Binding var attachments: [ChatAttachment]
  @ObservedObject var settings: SettingsStore
  let models: [OpenAIModelInfo]
  let selectedModel: String?
  let onModelChange: (String) -> Void
  let onSend: ([ChatAttachment]) -> Void
  let onShowTools: () -> Void
  let isProcessing: Bool
  @Binding var deepResearchEnabled: Bool

  @State private var showFilePicker = false
  @State private var showImagePicker = false
  @State private var imageItems: [PhotosPickerItem] = []
  @State private var isTranscribing = false
  @StateObject private var recorder = AudioRecorder()

  var body: some View {
    VStack(spacing: 6) {
      if !attachments.isEmpty {
        ChatAttachmentsView(attachments: attachments, onRemove: removeAttachment)
      }
      if isTranscribing { Text("Transcribing...").font(AppTheme.captionFont).foregroundColor(AppTheme.muted) }
      TextField("Message...", text: $text, axis: .vertical)
        .lineLimit(1...6)
        .textFieldStyle(.plain)
        .foregroundColor(AppTheme.foreground)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppTheme.card)
        .cornerRadius(12)
      HStack(spacing: 12) {
        ChatToolBeltToolbar(
          models: models,
          selectedModel: selectedModel,
          onModelChange: onModelChange,
          mcpEnabled: settings.mcpEnabled,
          onMcpToggle: { settings.mcpEnabled.toggle() },
          deepResearchEnabled: deepResearchEnabled,
          onDeepResearchToggle: { deepResearchEnabled.toggle() },
          planModeEnabled: settings.planModeEnabled,
          onPlanModeToggle: { settings.planModeEnabled.toggle() },
          isRecording: recorder.isRecording,
          onAddFile: { showFilePicker = true },
          onAddImage: { showImagePicker = true },
          onRecord: { handleRecord() },
          onShowTools: onShowTools
        )
        Button(action: { onSend(attachments) }) {
          Image(systemName: "arrow.up")
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(canSend ? AppTheme.foreground : AppTheme.muted)
            .frame(width: 30, height: 30)
            .background(canSend ? (isProcessing ? AppTheme.error : AppTheme.accentStrong) : AppTheme.border)
            .clipShape(Circle())
        }
        .disabled(!canSend)
      }
    }
    .photosPicker(isPresented: $showImagePicker, selection: $imageItems, matching: .images)
    .fileImporter(isPresented: $showFilePicker, allowedContentTypes: [.data], onCompletion: handleFileResult)
    .onChange(of: imageItems) { oldItems, newItems in
      Task {
        for item in newItems {
          if let data = try? await item.loadTransferable(type: Data.self),
             let image = UIImage(data: data) {
            attachments.append(ChatAttachment(id: UUID().uuidString, name: "Image", type: .image, url: nil, image: image))
          }
        }
        imageItems = []
      }
    }
  }

  var canSend: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
  }

  func removeAttachment(_ attachment: ChatAttachment) {
    attachments.removeAll { $0.id == attachment.id }
  }

  func handleFileResult(_ result: Result<URL, Error>) {
    guard case let .success(url) = result else { return }
    attachments.append(ChatAttachment(id: UUID().uuidString, name: url.lastPathComponent, type: .file, url: url, image: nil))
  }

  func handleRecord() {
    Task {
      if recorder.isRecording {
        guard let url = recorder.stop() else { return }
        attachments.append(ChatAttachment(id: UUID().uuidString, name: url.lastPathComponent, type: .audio, url: url, image: nil))
        await transcribeAudio(url)
      } else {
        await recorder.start()
      }
    }
  }

  func transcribeAudio(_ url: URL) async {
    isTranscribing = true
    defer { isTranscribing = false }
    if let text = try? await VoiceTranscriber.transcribe(fileUrl: url, settings: settings) {
      self.text = [self.text, text].filter { !$0.isEmpty }.joined(separator: " ")
    }
  }
}
