// CRITICAL
import SwiftUI

struct ChatDetailView: View {
  let sessionId: String
  @EnvironmentObject private var container: AppContainer
  @StateObject private var model = ChatDetailViewModel()
  @State private var attachments: [ChatAttachment] = []
  @State private var showTools = false
  @State private var activeActions: ChatAgentActions?
  @State private var showContext = false
  @State private var forkedSessionId: String?

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
          if let error = model.error {
            HStack {
              Image(systemName: "exclamationmark.triangle")
              Text(error).font(AppTheme.captionFont)
              Spacer()
              Button("Dismiss") { model.error = nil }
                .font(AppTheme.captionFont)
            }
            .foregroundColor(AppTheme.error)
            .padding(10)
            .background(AppTheme.error.opacity(0.1))
            .cornerRadius(8)
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
            .equatable()
            .id(message.id)
          }
          if model.openAIService.isStreaming {
            ChatStreamingMessageView(
              service: model.openAIService,
              scrollProxy: proxy,
              onShowActions: { meta in
                activeActions = ChatAgentActions(id: "streaming", title: "Model is thinking", meta: meta, startedAt: model.openAIService.streamStart, isStreaming: true)
              }
            )
          }
        }
        .padding(16)
        .padding(.bottom, 80)
      }
      .onChange(of: model.messages.count) { _, _ in
        if let last = model.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
      }
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 8) {
        if let start = model.openAIService.streamStart, model.openAIService.isStreaming {
          ChatProcessingBar(startedAt: start) {
            let meta = AgentMeta(
              thinkingBlocks: model.openAIService.streamingReasoning.isEmpty ? [] : [model.openAIService.streamingReasoning],
              toolCalls: model.openAIService.streamingToolCalls,
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
          isProcessing: model.openAIService.isStreaming,
          deepResearchEnabled: $model.deepResearchEnabled
        )
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(AppTheme.background)
    }
    .background(AppTheme.background)
    .navigationTitle(model.title.isEmpty ? "Chat" : model.title)
    .toolbar {
      ToolbarItem(placement: .navigationBarTrailing) {
        Menu {
          Button("Copy", systemImage: "doc.on.doc") { model.copyTranscript() }
          Button("Context", systemImage: "rectangle.and.text.magnifyingglass") { showContext = true }
          Button("Fork", systemImage: "arrow.branch") {
            Task {
              if let forked = await model.forkSession(messageId: nil, title: nil) {
                forkedSessionId = forked.id
              }
            }
          }
          Button("Retry", systemImage: "arrow.clockwise") {
            Task {
              if let forked = await model.retryFromLastUser() {
                forkedSessionId = forked.id
              }
            }
          }
          ShareLink(item: model.buildTranscript()) {
            Label("Export", systemImage: "square.and.arrow.up")
          }
        } label: {
          Image(systemName: "ellipsis.circle")
        }
      }
    }
    .sheet(isPresented: $showTools) { ChatToolsSheet(tools: model.tools) }
    .sheet(isPresented: $showContext) {
      ChatContextSheet(
        modelId: model.sessionModel,
        messageCount: model.messages.count,
        usage: model.chatUsage,
        toolsEnabled: container.settings.mcpEnabled,
        planEnabled: container.settings.planModeEnabled
      )
    }
    .sheet(item: $activeActions) { actions in
      ChatAgentActionsSheet(actions: actions)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .navigationDestination(isPresented: Binding(
      get: { forkedSessionId != nil },
      set: { if !$0 { forkedSessionId = nil } }
    )) {
      if let forkedSessionId { ChatDetailView(sessionId: forkedSessionId) }
    }
    .onAppear { model.connect(api: container.api, settings: container.settings, sessionId: sessionId) }
  }
}

private struct ChatContextSheet: View {
  let modelId: String?
  let messageCount: Int
  let usage: ChatUsage?
  let toolsEnabled: Bool
  let planEnabled: Bool
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        section("Model", value: modelId ?? "Default")
        section("Messages", value: "\(messageCount)")
        section("Tools", value: toolsEnabled ? "Enabled" : "Disabled")
        section("Planning", value: planEnabled ? "Enabled" : "Disabled")
        if let usage {
          section("Prompt tokens", value: "\(usage.promptTokens)")
          section("Completion tokens", value: "\(usage.completionTokens)")
          section("Total tokens", value: "\(usage.totalTokens)")
        }
      }
      .listStyle(.plain)
      .scrollContentBackground(.hidden)
      .background(AppTheme.background)
      .navigationTitle("Context")
      .toolbar { Button("Done") { dismiss() } }
    }
  }

  private func section(_ title: String, value: String) -> some View {
    HStack {
      Text(title).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
      Spacer()
      Text(value).font(AppTheme.bodyFont).foregroundColor(AppTheme.foreground)
    }
    .listRowBackground(AppTheme.card)
  }
}
