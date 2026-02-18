// CRITICAL
import { NextRequest, NextResponse } from "next/server";
import { getApiSettings } from "@/lib/api-settings";
import { resolveVoiceTarget } from "../voice-target";

const buildSilentWav = (durationMs = 650): Uint8Array => {
  const sampleRate = 16_000;
  const numSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const bytesPerSample = 2;
  const dataByteLength = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataByteLength, true);

  return new Uint8Array(buffer);
};

export async function POST(request: NextRequest) {
  try {
    if ((process.env["VLLM_STUDIO_MOCK_VOICE"] ?? "").trim() === "1") {
      const mockAudio = buildSilentWav();
      return new NextResponse(mockAudio as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-store",
        },
      });
    }

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const input = typeof payload["input"] === "string" ? payload["input"].trim() : "";
    if (!input) {
      return NextResponse.json({ error: "Missing 'input' text" }, { status: 400 });
    }

    const settings = await getApiSettings();
    const target = resolveVoiceTarget(settings);
    if (!target) {
      return NextResponse.json(
        { error: "Voice target not configured", details: "Configure backend URL or voice URL" },
        { status: 400 },
      );
    }

    const headers: HeadersInit = { "Content-Type": "application/json" };
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers["Authorization"] = incomingAuth;
    } else if (settings.apiKey) {
      headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }

    const response = await fetch(`${target.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const responseBody = await response.arrayBuffer();

    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[VOICE SPEAK PROXY ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 },
    );
  }
}
