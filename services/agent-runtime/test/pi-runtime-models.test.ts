import { describe, expect, it } from "vitest";
import { mergeControllers } from "../src/pi-runtime-models";

const settings = {
  backendUrl: "http://127.0.0.1:8080",
  apiKey: "saved-controller-key",
  voiceUrl: "",
  voiceModel: "whisper-large-v3-turbo",
};

describe("mergeControllers", () => {
  it("uses the persisted key for the matching requested controller", () => {
    expect(mergeControllers(settings, [{ url: "http://127.0.0.1:8080" }])).toEqual([
      { url: "http://127.0.0.1:8080", apiKey: "saved-controller-key" },
    ]);
  });

  it("treats loopback aliases as the same controller", () => {
    expect(mergeControllers(settings, [{ url: "http://localhost:8080" }])).toEqual([
      { url: "http://localhost:8080", apiKey: "saved-controller-key" },
    ]);
  });

  it("does not send a persisted key to a different controller", () => {
    expect(mergeControllers(settings, [{ url: "http://example.test:8080" }])).toEqual([
      { url: "http://example.test:8080", apiKey: "" },
    ]);
  });

  it("keeps an explicitly requested key", () => {
    expect(
      mergeControllers(settings, [
        { url: "http://localhost:8080", apiKey: "requested-controller-key" },
      ]),
    ).toEqual([{ url: "http://localhost:8080", apiKey: "requested-controller-key" }]);
  });
});
