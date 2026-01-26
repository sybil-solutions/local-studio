// CRITICAL
import SwiftUI

struct ChatDetailView: View {
  let sessionId: String
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ChatDetailViewModel()
  @State private var attachments: [ChatAttachment] = []
  @State private var showTools = false
  @State private var activeActions: ChatAgentActions?

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(spacing: 12) {
          if let modelId = model.sessionModel {
            HStack {
              Text(modelId).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
              Spacer()
            }
            .padding(.horizontal, 4)
          }
          ChatUsageBar(usage: model.chatUsage)
          ForEach(model.visibleMessages) { message in
            ChatMessageRow(
              message: message,
              isStreaming: false,
              meta: model.meta(for: message),
              onShowActions: { meta in
                activeActions = ChatAgentActions(id: message.id, title: "Agent actions", meta: meta, startedAt: nil, isStreaming: false)
              }
            )
            .id(message.id)
          }
          if model.isStreaming {
            let streamingMessage = StoredMessage(
              id: "streaming",
              role: "assistant",
              content: model.streamingContent,
              model: nil,
              toolCalls: nil
            )
            let streamingMeta = AgentMeta(
              thinkingBlocks: model.streamingReasoning.isEmpty ? [] : [model.streamingReasoning],
              toolCalls: model.streamingToolCalls,
              toolResults: []
            )
            ChatMessageRow(
              message: streamingMessage,
              isStreaming: true,
              meta: streamingMeta,
              onShowActions: { meta in
                activeActions = ChatAgentActions(id: "streaming", title: "Model is thinking", meta: meta, startedAt: model.streamStart, isStreaming: true)
              }
            )
            .id("streaming")
          }
        }
        .padding(16)
        .padding(.bottom, 80)
      }
      .onChange(of: model.messages.count) { _, _ in
        if let last = model.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
      }
      .onChange(of: model.streamingContent) { _, _ in
        proxy.scrollTo("streaming", anchor: .bottom)
      }
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 8) {
        if let start = model.streamStart, model.isStreaming {
          ChatProcessingBar(startedAt: start) {
            let meta = AgentMeta(
              thinkingBlocks: model.streamingReasoning.isEmpty ? [] : [model.streamingReasoning],
              toolCalls: model.streamingToolCalls,
              toolResults: []
            )
            activeActions = ChatAgentActions(id: "stream", title: "Model is thinking", meta: meta, startedAt: start, isStreaming: true)
          }
        }
        ChatToolBelt(
          text: $model.input,
          attachments: $attachments,
          settings: container.settings,
          models: model.availableModels,
          selectedModel: model.sessionModel,
          onModelChange: { modelId in Task { await model.updateModel(modelId) } },
          onSend: { items in Task { await model.sendMessage(attachments: items); attachments = [] } },
          onShowTools: { showTools = true },
          isProcessing: model.isStreaming,
          deepResearchEnabled: $model.deepResearchEnabled
        )
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(AppTheme.background)
    }
    .background(AppTheme.background)
    .navigationTitle(model.title.isEmpty ? "Chat" : model.title)
    .sheet(isPresented: $showTools) { ChatToolsSheet(tools: model.tools) }
    .sheet(item: $activeActions) { actions in
      ChatAgentActionsSheet(actions: actions)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .onAppear { model.connect(api: container.api, settings: container.settings, sessionId: sessionId) }
  }
}
