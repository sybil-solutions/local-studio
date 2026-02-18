// CRITICAL
import { NextRequest, NextResponse } from "next/server";
import { getApiSettings } from "@/lib/api-settings";
import { resolveVoiceTarget } from "../voice-target";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const settings = await getApiSettings();
    const target = resolveVoiceTarget(settings);

    if (!target) {
      return NextResponse.json(
        { error: "Voice target not configured", details: "Configure backend URL or voice URL" },
        { status: 400 },
      );
    }

    if (target.kind === "external-voice") {
      const configuredModel = settings.voiceModel?.trim();
      const requestModel = formData.get("model");
      if (configuredModel && (typeof requestModel !== "string" || requestModel.trim().length === 0)) {
        formData.set("model", configuredModel);
      }
    } else {
      const requestModel = formData.get("model");
      if (typeof requestModel === "string" && requestModel.trim().toLowerCase() === "whisper-1") {
        formData.delete("model");
      }
    }

    const headers: HeadersInit = {};
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers["Authorization"] = incomingAuth;
    } else if (settings.apiKey) {
      headers["Authorization"] = `Bearer ${settings.apiKey}`;
    }

    const response = await fetch(`${target.baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers,
      body: formData,
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const payload = await response.text();

    return new NextResponse(payload, {
      status: response.status,
      headers: { "Content-Type": contentType },
    });
  } catch (error) {
    console.error("[VOICE PROXY ERROR]", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 },
    );
  }
}
