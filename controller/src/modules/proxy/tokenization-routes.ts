import type { Hono } from "hono";
import { observeControllerFunction } from "../../core/function-observability";
import type { AppContext } from "../../types/context";
import { fetchInference } from "../../services/inference/inference-client";

export const registerTokenizationRoutes = (app: Hono, context: AppContext): void => {
  app.post("/v1/tokenize", async (ctx) => {
    const current = await observeControllerFunction(context, "tokenize.findInferenceProcess", () =>
      context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (!current) {
      return ctx.json({ error: "No model running", num_tokens: 0 });
    }
    let body: unknown = {};
    try {
      body = await ctx.req.json();
    } catch (error) {
      return ctx.json({ error: String(error), num_tokens: 0 });
    }
    try {
      const response = await fetchInference(context, "/tokenize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 200) {
        return ctx.json(await response.json());
      }
      return ctx.json({ error: `Tokenization failed: ${response.status}`, num_tokens: 0 });
    } catch (error) {
      return ctx.json({ error: String(error), num_tokens: 0 });
    }
  });

  app.post("/v1/detokenize", async (ctx) => {
    const current = await observeControllerFunction(
      context,
      "detokenize.findInferenceProcess",
      () => context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (!current) {
      return ctx.json({ error: "No model running", text: "" });
    }
    let body: unknown = {};
    try {
      body = await ctx.req.json();
    } catch (error) {
      return ctx.json({ error: String(error), text: "" });
    }
    try {
      const response = await fetchInference(context, "/detokenize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 200) {
        return ctx.json(await response.json());
      }
      return ctx.json({ error: `Detokenization failed: ${response.status}`, text: "" });
    } catch (error) {
      return ctx.json({ error: String(error), text: "" });
    }
  });

  app.post("/v1/count-tokens", async (ctx) => {
    const current = await observeControllerFunction(
      context,
      "countTokens.findInferenceProcess",
      () => context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (!current) {
      return ctx.json({ error: "No model running", num_tokens: 0 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch (error) {
      return ctx.json({ error: String(error), num_tokens: 0 });
    }
    const text = typeof body["text"] === "string" ? body["text"] : "";
    const model =
      typeof body["model"] === "string" ? body["model"] : (current.served_model_name ?? "default");
    try {
      const response = await fetchInference(context, "/tokenize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
      if (response.status === 200) {
        const data = (await response.json()) as { tokens?: unknown[] };
        const tokens = Array.isArray(data.tokens) ? data.tokens : [];
        return ctx.json({ num_tokens: tokens.length, model });
      }
      return ctx.json({ error: `Token count failed: ${response.status}`, num_tokens: 0 });
    } catch (error) {
      return ctx.json({ error: String(error), num_tokens: 0 });
    }
  });

  app.post("/v1/tokenize-chat-completions", async (ctx) => {
    const current = await observeControllerFunction(
      context,
      "tokenizeChatCompletions.findInferenceProcess",
      () => context.processManager.findInferenceProcess(context.config.inference_port)
    );
    if (!current) {
      return ctx.json({ error: "No model running", input_tokens: 0 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await ctx.req.json()) as Record<string, unknown>;
    } catch (error) {
      return ctx.json({ error: String(error), input_tokens: 0 });
    }
    const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
    const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
    const model =
      typeof body["model"] === "string" ? body["model"] : (current.served_model_name ?? "default");

    try {
      const testRequest: Record<string, unknown> = {
        model,
        messages,
        max_tokens: 1,
        stream: false,
      };
      if (tools.length > 0) {
        testRequest["tools"] = tools;
      }
      const response = await fetchInference(context, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testRequest),
      });
      if (response.status === 200) {
        const data = (await response.json()) as { usage?: Record<string, number> };
        const promptTokens = data.usage?.["prompt_tokens"] ?? 0;
        return ctx.json({
          input_tokens: promptTokens,
          breakdown: { messages: promptTokens, tools: 0 },
          model,
        });
      }
    } catch {
      await Promise.resolve();
    }

    let messagesTokens = 0;
    let toolsTokens = 0;
    try {
      let allText = "";
      for (const message of messages) {
        const record = message as Record<string, unknown>;
        const content = record["content"];
        if (typeof content === "string") {
          allText += `${content}\n`;
        } else if (Array.isArray(content)) {
          for (const part of content) {
            const partRecord = part as Record<string, unknown>;
            if (partRecord["type"] === "text") {
              allText += `${String(partRecord["text"] ?? "")}\n`;
            }
          }
        }
      }

      const response = await fetchInference(context, "/tokenize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: allText }),
      });
      if (response.status === 200) {
        const data = (await response.json()) as { tokens?: unknown[] };
        messagesTokens = Array.isArray(data.tokens) ? data.tokens.length : 0;
      }

      if (tools.length > 0) {
        const toolsText = JSON.stringify(tools);
        const toolsResponse = await fetchInference(context, "/tokenize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: toolsText }),
        });
        if (toolsResponse.status === 200) {
          const data = (await toolsResponse.json()) as { tokens?: unknown[] };
          toolsTokens = Array.isArray(data.tokens) ? data.tokens.length : 0;
        }
      }
    } catch {
      await Promise.resolve();
    }

    const overhead = messages.length * 4;
    return ctx.json({
      input_tokens: messagesTokens + toolsTokens + overhead,
      breakdown: {
        messages: messagesTokens + overhead,
        tools: toolsTokens,
      },
      model,
    });
  });

  app.post("/api/title", async (ctx) => {
    try {
      let body: Record<string, unknown> = {};
      try {
        body = (await ctx.req.json()) as Record<string, unknown>;
      } catch {
        return ctx.json({ title: "New Chat" });
      }
      const model = typeof body["model"] === "string" ? body["model"] : undefined;
      const userMessage = typeof body["user"] === "string" ? body["user"] : "";
      const assistantMessage = typeof body["assistant"] === "string" ? body["assistant"] : "";

      if (!model || !userMessage) {
        return ctx.json({ title: "New Chat" });
      }

      const prompt = `You label developer chat threads. Reply with ONE short title only: 3–8 words, Title Case, no quotes, no markdown, no trailing punctuation.

Focus on the user's goal: bug, feature, refactor, question, or error. Prefer concrete nouns and verbs from the user message. If the assistant only acknowledged, still name the topic from the user.

User message:
${userMessage.slice(0, 700)}

${assistantMessage.trim() ? `Assistant (for context, may be partial):\n${assistantMessage.slice(0, 500)}` : "Assistant reply not included yet — infer the topic from the user message only."}`;

      const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
      const response = await fetchInference(context, "/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 36,
          temperature: 0.35,
        }),
      });

      if (response.status === 200) {
        const data = (await response.json()) as Record<string, unknown>;
        const choices = data["choices"] as Array<Record<string, unknown>> | undefined;
        const firstChoice = choices?.[0];
        const titleRaw =
          firstChoice && (firstChoice["message"] as Record<string, unknown>)?.["content"];
        let title = typeof titleRaw === "string" ? titleRaw.trim() : "";
        title = title.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
        title = title.replace(/<\/?think(?:ing)?[^>]*>/gi, "").trim();
        title = title.replace(/^["']|["']$/g, "").trim();
        if (title.length > 60) {
          title = `${title.slice(0, 57)}...`;
        }
        return ctx.json({ title: title || "New Chat" });
      }

      return ctx.json({ title: "New Chat" });
    } catch (error) {
      context.logger.error("Title generation error", { error: String(error) });
      return ctx.json({ title: "New Chat" });
    }
  });
};
