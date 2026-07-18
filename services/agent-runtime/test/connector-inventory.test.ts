import { describe, expect, test } from "bun:test";
import { connectorInventoryDigest } from "../src/connector-inventory";

describe("connector inventory identity", () => {
  test("is order independent and binds every advertised tool field", () => {
    const tools = [
      {
        name: "observe",
        description: "Read state",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        annotations: { readOnlyHint: true },
      },
      { name: "mutate", annotations: { destructiveHint: true } },
    ];
    const initial = connectorInventoryDigest(tools);
    expect(connectorInventoryDigest([...tools].reverse())).toBe(initial);
    expect(connectorInventoryDigest([{ ...tools[0], description: "Changed" }, tools[1]])).not.toBe(
      initial,
    );
    expect(
      connectorInventoryDigest([
        { ...tools[0], inputSchema: { type: "object", required: ["id"] } },
        tools[1],
      ]),
    ).not.toBe(initial);
    expect(
      connectorInventoryDigest([{ ...tools[0], annotations: { readOnlyHint: false } }, tools[1]]),
    ).not.toBe(initial);
  });
});
