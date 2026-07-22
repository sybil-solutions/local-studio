import { describe, expect, test } from "bun:test";
import { allowsPermission, type PermissionPolicyInput } from "./security";

const mainWebContents = {};
const appOrigin = "http://127.0.0.1:47100";

const baseInput = (overrides: Partial<PermissionPolicyInput>): PermissionPolicyInput => ({
  appOrigin,
  isMainFrame: true,
  mainWebContents,
  mediaTypes: undefined,
  permission: "clipboard-sanitized-write",
  requestingOrigin: appOrigin,
  requestingUrl: `${appOrigin}/agent`,
  requestingWebContents: mainWebContents,
  ...overrides,
});

describe("desktop permission policy", () => {
  test("allows sanitized clipboard writes from the app main frame", () => {
    expect(allowsPermission(baseInput({}))).toBe(true);
  });

  test("denies clipboard writes from other origins", () => {
    expect(allowsPermission(baseInput({ requestingOrigin: "https://evil.example" }))).toBe(false);
  });

  test("denies clipboard writes from subframes", () => {
    expect(allowsPermission(baseInput({ isMainFrame: false }))).toBe(false);
  });

  test("denies clipboard writes from other web contents", () => {
    expect(allowsPermission(baseInput({ requestingWebContents: {} }))).toBe(false);
  });

  test("still allows audio-only microphone requests", () => {
    expect(allowsPermission(baseInput({ permission: "media", mediaTypes: ["audio"] }))).toBe(true);
  });

  test("still denies video media requests", () => {
    expect(
      allowsPermission(baseInput({ permission: "media", mediaTypes: ["audio", "video"] })),
    ).toBe(false);
  });

  test("denies unrelated permissions", () => {
    expect(allowsPermission(baseInput({ permission: "geolocation" }))).toBe(false);
  });
});
