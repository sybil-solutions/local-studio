import { NextRequest, NextResponse } from 'next/server';

const VOICE_URL = process.env.VOICE_URL || 'https://voice.homelabai.org';
const API_KEY = process.env.API_KEY || '';

export async function POST(request: NextRequest) {
  try {
    // Get the form data from the request
    const formData = await request.formData();

    // Build headers with API key
    const headers: HeadersInit = {};

    // Use incoming auth or fallback to server API key
    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) {
      headers['Authorization'] = incomingAuth;
    } else if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    // Forward to voice transcription service
    const response = await fetch(`${VOICE_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: 'Transcription failed', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error('[VOICE PROXY ERROR]', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
