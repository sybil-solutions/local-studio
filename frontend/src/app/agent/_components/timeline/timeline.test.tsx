import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/agent/session";
import { Timeline } from "./timeline";

const virtuosoMock = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-virtuoso", async () => {
  const React = await import("react");

  return {
    Virtuoso: (props: {
      components?: {
        Footer?: React.ComponentType;
        Item?: React.ComponentType<{ children?: React.ReactNode }>;
        List?: React.ComponentType<{ children?: React.ReactNode }>;
      };
      computeItemKey: (index: number, message: ChatMessage) => string;
      data: ChatMessage[];
      itemContent: (index: number, message: ChatMessage) => React.ReactNode;
    }) => {
      virtuosoMock.calls.push(props as unknown as Record<string, unknown>);

      const Footer = props.components?.Footer;
      const Item =
        props.components?.Item ?? (({ children }) => React.createElement("div", null, children));
      const List =
        props.components?.List ?? (({ children }) => React.createElement("div", null, children));

      return React.createElement(
        "div",
        { "data-virtuoso": "true", "data-count": props.data.length },
        React.createElement(
          List,
          null,
          props.data.map((message, index) =>
            React.createElement(
              Item,
              { key: props.computeItemKey(index, message) },
              props.itemContent(index, message),
            ),
          ),
        ),
        Footer ? React.createElement(Footer) : null,
      );
    },
  };
});

vi.mock("./message-view", async () => {
  const React = await import("react");

  return {
    MessageView: ({ message }: { message: ChatMessage }) =>
      React.createElement("div", { "data-message-id": message.id }, message.text),
  };
});

const messages: ChatMessage[] = [
  { id: "sys", role: "system", text: "hidden system note" },
  { id: "user", role: "user", text: "hello" },
  { id: "assistant", role: "assistant", text: "answer", blocks: [] },
];

describe("Timeline", () => {
  beforeEach(() => {
    virtuosoMock.calls = [];
  });

  it("keeps the empty prompt outside the virtualized list", () => {
    const html = renderToStaticMarkup(<Timeline messages={messages} running={false} emptyPrompt />);

    expect(html).toContain("A dream is something you build for yourself.");
    expect(html).not.toContain("data-virtuoso");
    expect(virtuosoMock.calls).toHaveLength(0);
  });

  it("filters system messages before rendering virtualized rows", () => {
    const html = renderToStaticMarkup(<Timeline messages={messages} running={false} />);
    const call = virtuosoMock.calls[0] as {
      alignToBottom: boolean;
      atBottomThreshold: number;
      computeItemKey: (index: number, message: ChatMessage) => string;
      data: ChatMessage[];
    };

    expect(html).toContain('data-count="2"');
    expect(html).not.toContain("hidden system note");
    expect(call.data.map((message) => message.id)).toEqual(["user", "assistant"]);
    expect(call.computeItemKey(0, call.data[0])).toBe("user");
    expect(call.alignToBottom).toBe(true);
    expect(call.atBottomThreshold).toBe(80);
  });

  it("keeps following output while running even if bottom state briefly drifts", () => {
    const onStickToBottomChange = vi.fn();

    renderToStaticMarkup(
      <Timeline
        messages={messages}
        running
        statusLabel="running"
        stickToBottom={false}
        onStickToBottomChange={onStickToBottomChange}
      />,
    );
    const call = virtuosoMock.calls[0] as {
      atBottomStateChange: (value: boolean) => void;
      followOutput: () => "auto" | false;
    };

    expect(call.followOutput()).toBe("auto");

    call.atBottomStateChange(true);
    expect(onStickToBottomChange).toHaveBeenCalledWith(true);
  });

  it("does not follow output after the user scrolls away from an idle session", () => {
    renderToStaticMarkup(<Timeline messages={messages} running={false} stickToBottom={false} />);
    const call = virtuosoMock.calls[0] as { followOutput: () => "auto" | false };

    expect(call.followOutput()).toBe(false);
  });
});
