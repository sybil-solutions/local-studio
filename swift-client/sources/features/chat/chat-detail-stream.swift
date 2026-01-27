// CRITICAL
import Foundation

extension ChatDetailViewModel {
  func streamTurn(api: ApiClient, userContent: String) async {
    openAIService.configure(
      apiKey: settings?.apiKey ?? "",
      baseURL: settings?.backendUrl ?? "http://localhost:8080"
    )
    let model = sessionModel ?? "default"
    let maxToolRounds = 10
    var rounds = 0
    var finalAssistantContent = ""

    while true {
      // Build tools: MCP defs (if enabled) + plan defs (if enabled)
      var toolDefs: [ToolDefinition] = []
      if settings?.mcpEnabled == true { toolDefs.append(contentsOf: tools.map { toolDef(for: $0) }) }
      if settings?.planModeEnabled == true { toolDefs.append(contentsOf: PlanTools.definitions) }
      let activeTools = toolDefs.isEmpty ? nil : toolDefs

      let promptMessages = buildPromptMessages()
      let tokenization = await tokenizePrompt(api: api, model: model, messages: promptMessages, tools: activeTools)

      let result: OpenAIChatService.StreamResult
      do {
        result = try await openAIService.streamChat(
          messages: promptMessages,
          model: model,
          tools: activeTools
        )
      } catch {
        self.error = error.localizedDescription
        return
      }

      let content = wrapThinking(result.reasoning, content: result.content)
      let assistantId = UUID().uuidString
      let tokenSnapshot = mergeTokenUsage(tokenization: tokenization, usage: result.usage)
      let assistant = StoredMessage(
        id: assistantId,
        role: "assistant",
        content: content,
        model: model,
        toolCalls: result.toolCalls.isEmpty ? nil : result.toolCalls,
        promptTokens: tokenSnapshot.promptTokens,
        toolsTokens: tokenSnapshot.toolsTokens,
        totalInputTokens: tokenSnapshot.totalInputTokens,
        completionTokens: tokenSnapshot.completionTokens
      )
      self.messages.append(assistant)
      refreshUsageSnapshot()
      _ = try? await api.addMessage(sessionId: sessionId, message: assistant)
      agentMeta[assistantId] = AgentMeta(
        thinkingBlocks: thinkingBlocks(from: result.reasoning, content: content),
        toolCalls: result.toolCalls,
        toolResults: []
      )

      // No tool calls — done
      if result.toolCalls.isEmpty {
        finalAssistantContent = result.content
        break
      }

      // Split calls: plan vs MCP
      let planCalls = result.toolCalls.filter { PlanTools.names.contains($0.function.name) }
      let mcpCalls = result.toolCalls.filter { !PlanTools.names.contains($0.function.name) }

      // Handle plan calls locally
      for call in planCalls {
        let planResult = PlanToolHandler.handle(call: call, currentPlan: currentPlan)
        currentPlan = planResult.plan
        let toolMsg = StoredMessage(
          id: UUID().uuidString, role: "tool", content: planResult.resultContent,
          model: nil, toolCalls: nil, toolCallId: call.id
        )
        self.messages.append(toolMsg)
        _ = try? await api.addMessage(sessionId: sessionId, message: toolMsg)
      }

      // Handle MCP calls via runner
      if !mcpCalls.isEmpty {
        let mcpResults = await McpToolRunner(api: api).run(calls: mcpCalls)
        for toolMessage in mcpResults {
          self.messages.append(toolMessage)
          _ = try? await api.addMessage(sessionId: sessionId, message: toolMessage)
        }
        if var meta = agentMeta[assistantId] {
          meta.toolResults.append(contentsOf: mcpResults.compactMap { $0.content })
          agentMeta[assistantId] = meta
        }
      }

      rounds += 1
      if rounds >= maxToolRounds {
        finalAssistantContent = result.content
        break
      }
    }

    if !finalAssistantContent.isEmpty {
      await updateTitle(user: userContent, assistant: finalAssistantContent, api: api)
    }
  }

  private func tokenizePrompt(
    api: ApiClient,
    model: String,
    messages: [OpenAIMessage],
    tools: [ToolDefinition]?
  ) async -> TokenizeChatResponse? {
    do {
      return try await api.tokenizeChatCompletions(model: model, messages: messages, tools: tools)
    } catch {
      return nil
    }
  }

  private func mergeTokenUsage(
    tokenization: TokenizeChatResponse?,
    usage: CompletionUsage?
  ) -> TokenUsageSnapshot {
    let promptTokens = tokenization?.breakdown?.messages ?? usage?.promptTokens
    let toolsTokens = tokenization?.breakdown?.tools
    let totalInputTokens = tokenization?.inputTokens ?? usage?.promptTokens
    let completionTokens = usage?.completionTokens
    return TokenUsageSnapshot(
      promptTokens: promptTokens,
      toolsTokens: toolsTokens,
      totalInputTokens: totalInputTokens,
      completionTokens: completionTokens
    )
  }

  private struct TokenUsageSnapshot {
    let promptTokens: Int?
    let toolsTokens: Int?
    let totalInputTokens: Int?
    let completionTokens: Int?
  }

  private func thinkingBlocks(from thinking: String, content: String) -> [String] {
    let trimmed = thinking.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { return [trimmed] }
    return ThinkingParser.extractAllBlocks(content)
  }

  private func wrapThinking(_ thinking: String, content: String) -> String {
    let trimmed = thinking.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return content }
    let lowerContent = content.lowercased()
    if lowerContent.contains("<think>") || lowerContent.contains("<thinking>") {
      return content
    }
    return "<think>\(trimmed)</think>\n\(content)"
  }
}
