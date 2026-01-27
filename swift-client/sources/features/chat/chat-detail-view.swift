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
            HStack(spacing: 6) {
              Image(systemName: "cpu")
                .font(.system(size: 10))
                .foregroundColor(AppTheme.accentStrong)
              Text(modelId)
                .font(AppTheme.captionFont.weight(.medium))
                .foregroundColor(AppTheme.muted)
              Spacer()
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 4)
          }
          if let error = model.error {
            VStack(alignment: .leading, spacing: 8) {
              HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("Error")
                  .font(AppTheme.sectionFont)
                Spacer()
                Button(action: { model.error = nil }) {
                  Image(systemName: "xmark.circle.fill")
                    .foregroundColor(AppTheme.muted)
                }
              }
              Text(error)
                .font(AppTheme.bodyFont)
            }
            .foregroundColor(AppTheme.error)
            .padding(12)
            .background(AppTheme.error.opacity(0.15))
            .cornerRadius(12)
            .overlay(
              RoundedRectangle(cornerRadius: 12)
                .stroke(AppTheme.error.opacity(0.3), lineWidth: 1)
            )
          }
          // Messages or empty state
          let hasContent = !model.visibleMessages.isEmpty || model.openAIService.isStreaming
          if !hasContent {
            EmptyChatWelcome()
          } else {
            ForEach(model.visibleMessages) { message in
              let actions = message.role == "assistant" ? MessageActionHandlers(
                onCopy: { model.copyMessage(message) },
                onContext: { showContext = true },
                onFork: {
                  Task {
                    if let forked = await model.forkSession(messageId: message.id, title: nil) {
                      forkedSessionId = forked.id
                    }
                  }
                },
                onRetry: {
                  Task {
                    if let forked = await model.forkSession(messageId: message.id, title: "Retry") {
                      forkedSessionId = forked.id
                    }
                  }
                }
              ) : nil
              ChatMessageRow(
                message: message,
                isStreaming: false,
                meta: model.meta(for: message),
                onShowActions: { meta in
                  activeActions = ChatAgentActions(id: message.id, title: "Agent actions", meta: meta, startedAt: nil, isStreaming: false)
                },
                actions: actions
              )
              .equatable()
              .id(message.id)
            }
            
            // Streaming response appears as the last message
            if model.openAIService.isStreaming {
              ChatStreamingMessageView(
                service: model.openAIService,
                scrollProxy: proxy,
                onShowActions: { meta in
                  activeActions = ChatAgentActions(id: "streaming", title: "Model is thinking", meta: meta, startedAt: model.openAIService.streamStart, isStreaming: true)
                }
              )
            }
            
            if !model.visibleMessages.isEmpty {
              ChatUsageBar(usage: model.chatUsage)
                .padding(.top, 8)
            }
          }
        }
        .padding(16)
        .padding(.bottom, 80)
      }
      .onChange(of: model.messages.count) { _, _ in
        withAnimation(.easeOut(duration: 0.2)) {
          if let last = model.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
        }
      }
      .onChange(of: model.openAIService.isStreaming) { _, isStreaming in
        if isStreaming {
          withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo("streaming", anchor: .bottom)
          }
        }
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
    .navigationBarTitleDisplayMode(.inline)
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

private struct EmptyChatWelcome: View {
  @State private var isAnimating = false
  
  var body: some View {
    VStack(spacing: 24) {
      Spacer().frame(height: 40)
      
      // Animated icon
      ZStack {
        Circle()
          .fill(AppTheme.accent.opacity(0.2))
          .frame(width: 120, height: 120)
          .scaleEffect(isAnimating ? 1.05 : 1.0)
          .animation(.easeInOut(duration: 2).repeatForever(autoreverses: true), value: isAnimating)
        
        Circle()
          .fill(AppTheme.accent.opacity(0.3))
          .frame(width: 90, height: 90)
          .scaleEffect(isAnimating ? 1.08 : 1.0)
          .animation(.easeInOut(duration: 2).delay(0.3).repeatForever(autoreverses: true), value: isAnimating)
        
        Image(systemName: "bubble.left.and.bubble.right.fill")
          .font(.system(size: 40))
          .foregroundColor(AppTheme.accentStrong)
      }
      
      VStack(spacing: 8) {
        Text("Start a conversation")
          .font(AppTheme.titleFont)
          .foregroundColor(AppTheme.foreground)
        
        Text("Ask anything, upload files, or enable tools to get started")
          .font(AppTheme.bodyFont)
          .foregroundColor(AppTheme.muted)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
      }
      
      // Quick suggestion chips
      HStack(spacing: 8) {
        SuggestionChip(text: "Help me code")
        SuggestionChip(text: "Explain a concept")
        SuggestionChip(text: "Analyze data")
      }
      .padding(.top, 8)
      
      Spacer()
    }
    .frame(maxWidth: .infinity)
    .onAppear { isAnimating = true }
  }
}

private struct SuggestionChip: View {
  let text: String
  
  var body: some View {
    Text(text)
      .font(AppTheme.captionFont)
      .foregroundColor(AppTheme.muted)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(AppTheme.card)
      .cornerRadius(16)
      .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppTheme.border, lineWidth: 1))
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
