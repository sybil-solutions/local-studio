import { NextRequest, NextResponse } from 'next/server';
import { getApiSettings, saveApiSettings, maskApiKey, ApiSettings } from '@/lib/api-settings';

export async function GET() {
  try {
    const settings = await getApiSettings();
    // Return settings with masked API key for display
    return NextResponse.json({
      backendUrl: settings.backendUrl,
      litellmUrl: settings.litellmUrl,
      apiKey: maskApiKey(settings.apiKey),
      hasApiKey: Boolean(settings.apiKey),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load settings', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { backendUrl, litellmUrl, apiKey } = body as Partial<ApiSettings>;

    // Validate URLs
    if (backendUrl && !isValidUrl(backendUrl)) {
      return NextResponse.json(
        { error: 'Invalid backend URL format' },
        { status: 400 }
      );
    }
    if (litellmUrl && !isValidUrl(litellmUrl)) {
      return NextResponse.json(
        { error: 'Invalid LiteLLM URL format' },
        { status: 400 }
      );
    }

    // Get current settings to preserve unchanged values
    const current = await getApiSettings();

    const newSettings: ApiSettings = {
      backendUrl: backendUrl || current.backendUrl,
      litellmUrl: litellmUrl || current.litellmUrl,
      // Only update API key if explicitly provided (not masked value)
      apiKey: apiKey && !apiKey.includes('••••') ? apiKey : current.apiKey,
    };

    await saveApiSettings(newSettings);

    return NextResponse.json({
      success: true,
      backendUrl: newSettings.backendUrl,
      litellmUrl: newSettings.litellmUrl,
      apiKey: maskApiKey(newSettings.apiKey),
      hasApiKey: Boolean(newSettings.apiKey),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save settings', details: String(error) },
      { status: 500 }
    );
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
