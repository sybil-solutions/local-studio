import { describe, expect, it } from "vitest";
import { resolveVoiceTarget } from "./voice-target";

describe("resolveVoiceTarget", () => {
  it("uses external voice url when configured", () => {
    const target = resolveVoiceTarget({
      backendUrl: "http://localhost:8080",
      apiKey: "",
      voiceUrl: "https://voice.example.com/",
      voiceModel: "whisper-large-v3",
    });

    expect(target).toEqual({
      baseUrl: "https://voice.example.com",
      kind: "external-voice",
    });
  });

  it("treats matching voiceUrl/backendUrl as controller-local", () => {
    const target = resolveVoiceTarget({
      backendUrl: "http://localhost:8080/",
      apiKey: "",
      voiceUrl: "http://localhost:8080",
      voiceModel: "whisper-large-v3",
    });

    expect(target).toEqual({
      baseUrl: "http://localhost:8080",
      kind: "controller-local",
    });
  });

  it("falls back to backend url when voiceUrl is empty", () => {
    const target = resolveVoiceTarget({
      backendUrl: "http://localhost:8080",
      apiKey: "",
      voiceUrl: "",
      voiceModel: "whisper-large-v3",
    });

    expect(target).toEqual({
      baseUrl: "http://localhost:8080",
      kind: "controller-local",
    });
  });
});
