import { describe, expect, test } from "bun:test";

import { collectSseJson, createTestHarness, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("stream proxy keeps heartbeats alive after the first upstream chunk", async () => {
    const { buildChatCompletionsStreamResponse } = await import(
      "../../../controller/src/modules/proxy/chat-completions-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [{ index: 0, delta: { reasoning_content: "thinking" } }],
            })}\n\n`,
          ),
        );
        setTimeout(() => {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }, 200);
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(upstream, { status: 200, headers: { "content-type": "text/event-stream" } });
    try {
      const { context } = await createTestHarness();
      const response = buildChatCompletionsStreamResponse({
        upstreamUrl: "http://upstream.test/v1/chat/completions",
        headers: {},
        body: "{}",
        clientSignal: new AbortController().signal,
        matchedRecipe: null,
        sourceHeader: null,
        sessionId: null,
        recordedModel: "mock-model",
        recordedProvider: "local",
        requestStart: performance.now(),
        requestProvider: "local",
        providerRouting: null,
        context,
        keepaliveIntervalMs: 20,
      });
      const output = await response.text();
      expect((output.match(/: keepalive/g) ?? []).length).toBeGreaterThanOrEqual(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stream proxy keeps content with null tool_calls as answer text", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "Let me inspect the file first.",
                    tool_calls: null,
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        id: "call-read",
                        index: 0,
                        type: "function",
                        function: { name: "read", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Let me inspect the file first.");
    expect(delta?.reasoning_content).toBeUndefined();
    const toolEvent = events[1] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    expect(toolEvent.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({ id: "call-read" }),
    ]);
  });

  test("stream proxy keeps same-delta content visible when tool_calls are present", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "Let me inspect the file first.",
                    tool_calls: [
                      {
                        id: "call-read",
                        index: 0,
                        type: "function",
                        function: { name: "read", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Let me inspect the file first.");
    expect(delta?.reasoning_content).toBeUndefined();
    expect(delta?.tool_calls).toEqual([expect.objectContaining({ id: "call-read" })]);
  });

  test("stream proxy splits implicit thinking close tags without duplicating answer text", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "I should inspect this first. </think>Here is the answer.",
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Here is the answer.");
    expect(delta?.reasoning_content).toBe("I should inspect this first. ");
    expect(String(delta?.reasoning_content)).not.toContain("</think>");
    expect(String(delta?.reasoning_content)).not.toContain("Here is the answer.");
  });

  test("stream proxy buffers split implicit thinking until the close tag arrives", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const content of [
          "I should inspect ",
          "this first. </think>",
          "Here is the answer.",
        ]) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    index: 0,
                    delta: { content },
                  },
                ],
              })}\n\n`,
            ),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader(), undefined, undefined, {
        bufferImplicitReasoningContent: true,
      }),
    );
    const deltas = events.map((event) => {
      const choices = event["choices"] as Array<{ delta?: Record<string, unknown> }> | undefined;
      return choices?.[0]?.delta ?? {};
    });

    expect(deltas).toEqual([
      {},
      { reasoning_content: "I should inspect this first. " },
      { content: "Here is the answer." },
    ]);
  });

  test("stream proxy normalizes openai-compatible reasoning aliases", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    reasoning: "I should inspect this first.",
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.reasoning_content).toBe("I should inspect this first.");
    expect(delta?.reasoning).toBeUndefined();
  });

  test("message normalizer maps reasoning aliases to reasoning_content", async () => {
    const { normalizeReasoningAndContentInMessage } = await import(
      "../../../controller/src/modules/proxy/reasoning"
    );
    const message: Record<string, unknown> = {
      role: "assistant",
      content: "pong",
      reasoning: "The answer should be pong.",
    };

    normalizeReasoningAndContentInMessage(message);

    expect(message["content"]).toBe("pong");
    expect(message["reasoning_content"]).toBe("The answer should be pong.");
    expect(message["reasoning"]).toBeUndefined();
  });

  test("stream proxy still extracts XML tool calls after stripping visible content", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content:
                      '<tool_call>{"name":"read","arguments":{"path":"package.json"}}</tool_call>',
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const toolEvent = events.find((event) => {
      const choices = event["choices"];
      if (!Array.isArray(choices)) return false;
      const firstChoice = choices[0] as { delta?: Record<string, unknown> } | undefined;
      return Array.isArray(firstChoice?.delta?.tool_calls);
    }) as { choices?: Array<{ delta?: Record<string, unknown> }> } | undefined;

    expect(toolEvent?.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "read",
          arguments: JSON.stringify({ path: "package.json" }),
        }),
      }),
    ]);
  });

  test("stream proxy extracts bare JSON tool lines without showing them as content", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: [
                      JSON.stringify({
                        tool: "set_goal",
                        args: { objective: "Deep research on Oxsero" },
                      }),
                      JSON.stringify({
                        tool: "set_plan",
                        args: {
                          steps: [{ title: "Search for Oxsero on major platforms" }],
                        },
                      }),
                    ].join("\n"),
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const visibleContent = events
      .flatMap((event) =>
        Array.isArray(event["choices"])
          ? event["choices"].map((choice) =>
              String(
                ((choice as { delta?: Record<string, unknown> }).delta?.["content"] as
                  | string
                  | undefined) ?? "",
              ),
            )
          : [],
      )
      .join("");
    const toolEvent = events.find((event) => {
      const choices = event["choices"];
      if (!Array.isArray(choices)) return false;
      const firstChoice = choices[0] as { delta?: Record<string, unknown> } | undefined;
      return Array.isArray(firstChoice?.delta?.tool_calls);
    }) as { choices?: Array<{ delta?: Record<string, unknown> }> } | undefined;

    expect(visibleContent).not.toContain('"tool"');
    expect(toolEvent?.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "set_goal",
          arguments: JSON.stringify({ objective: "Deep research on Oxsero" }),
        }),
      }),
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "set_plan",
          arguments: JSON.stringify({
            steps: [{ title: "Search for Oxsero on major platforms" }],
          }),
        }),
      }),
    ]);
  });

  test("tool XML parser repairs malformed JSON arguments through pi-ai", async () => {
    const { parseToolCallsFromContent } = await import(
      "../../../controller/src/modules/proxy/tool-call-parser"
    );

    const [call] = parseToolCallsFromContent(
      `<tool_call><function=write_file><arguments>{"content":"hello
world"}</arguments></tool_call>`,
    );

    expect(call?.function.name).toBe("write_file");
    expect(JSON.parse(call?.function.arguments ?? "{}")).toEqual({
      content: "hello\nworld",
    });
  });

  test("tool XML parser extracts invoke parameter blocks", async () => {
    const { parseToolCallsFromContent, stripToolCallsFromContent } = await import(
      "../../../controller/src/modules/proxy/tool-call-parser"
    );

    const content =
      '<invoke name="set_goal"> <parameter name="objective">Deep research on 0xsero</parameter> </invoke>';
    const [call] = parseToolCallsFromContent(content);

    expect(call?.function.name).toBe("set_goal");
    expect(JSON.parse(call?.function.arguments ?? "{}")).toEqual({
      objective: "Deep research on 0xsero",
    });
    expect(stripToolCallsFromContent(content).trim()).toBe("");
  });

  test("strips orphan tool-call tags that leak from split/partial tool calls", async () => {
    const { stripToolCallsFromContent } = await import(
      "../../../controller/src/modules/proxy/tool-call-parser"
    );
    // A lone closing fragment (the screenshot bug): reasoning showed "</arg_value>".
    expect(stripToolCallsFromContent("</arg_value>").trim()).toBe("");
    // A tool call split across stream deltas leaves a partial, unmatched block.
    expect(
      stripToolCallsFromContent(
        "Done.\n<tool_call>\n<function=write>\n<parameter=path>\n<arg_value>x",
      ).trim(),
    ).toBe("Done.");
    // Real prose with similar words is untouched.
    expect(stripToolCallsFromContent("The function returns a value.")).toBe(
      "The function returns a value.",
    );
  });

  test("stream proxy extracts invoke XML tool calls without visible content", async () => {
    const { createToolCallStream } = await import(
      "../../../controller/src/modules/proxy/tool-call-stream"
    );
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content:
                      '<invoke name="set_goal"> <parameter name="objective">Deep research on 0xsero</parameter> </invoke>',
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(createToolCallStream(upstream.getReader()));
    const visibleContent = events
      .flatMap((event) =>
        Array.isArray(event["choices"])
          ? event["choices"].map((choice) =>
              String(
                ((choice as { delta?: Record<string, unknown> }).delta?.["content"] as
                  | string
                  | undefined) ?? "",
              ),
            )
          : [],
      )
      .join("");
    const toolEvent = events.find((event) => {
      const choices = event["choices"];
      if (!Array.isArray(choices)) return false;
      const firstChoice = choices[0] as { delta?: Record<string, unknown> } | undefined;
      return Array.isArray(firstChoice?.delta?.tool_calls);
    }) as { choices?: Array<{ delta?: Record<string, unknown> }> } | undefined;

    expect(visibleContent).not.toContain("<invoke");
    expect(toolEvent?.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "set_goal",
          arguments: JSON.stringify({ objective: "Deep research on 0xsero" }),
        }),
      }),
    ]);
  });
});
