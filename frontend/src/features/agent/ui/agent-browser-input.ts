type BrowserPoint = { x: number; y: number };

type BrowserBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type BrowserKeyEvent = {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
};

export type BrowserKeyInput = {
  code: string;
  key: string;
  kind: "key";
  text?: string;
  type: "char" | "down" | "up";
};

export function browserViewportPoint(
  bounds: BrowserBounds | null,
  viewport: { height: number; width: number },
  point: { clientX: number; clientY: number },
): BrowserPoint {
  if (!bounds || bounds.width === 0 || bounds.height === 0) return { x: 0, y: 0 };
  return {
    x: Math.round(((point.clientX - bounds.left) / bounds.width) * viewport.width),
    y: Math.round(((point.clientY - bounds.top) / bounds.height) * viewport.height),
  };
}

export function browserMouseButton(button: number): "left" | "middle" | "right" {
  return button === 1 ? "middle" : button === 2 ? "right" : "left";
}

export function browserKeyInputs(type: "down" | "up", event: BrowserKeyEvent): BrowserKeyInput[] {
  if (event.metaKey) return [];
  const inputs: BrowserKeyInput[] = [{ kind: "key", type, key: event.key, code: event.code }];
  if (type === "down" && event.key.length === 1 && !event.ctrlKey && !event.altKey) {
    inputs.push({
      kind: "key",
      type: "char",
      key: event.key,
      code: event.code,
      text: event.key,
    });
  }
  if (type === "down" && event.key === "Enter") {
    inputs.push({ kind: "key", type: "char", key: "Enter", code: "Enter", text: "\r" });
  }
  return inputs;
}
