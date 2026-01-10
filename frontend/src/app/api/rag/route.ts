import { NextRequest, NextResponse } from 'next/server';

// RAG proxy - forwards requests to the configured RAG endpoint
// This allows the browser to access a local RAG server through the frontend

const RAG_ENDPOINT = process.env.RAG_ENDPOINT || 'http://localhost:3002';
const RAG_API_KEY = process.env.RAG_API_KEY;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (RAG_API_KEY) {
      headers['Authorization'] = `Bearer ${RAG_API_KEY}`;
    }

    if (action === 'query') {
      const response = await fetch(`${RAG_ENDPOINT}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: params.query,
          top_k: params.top_k || 5,
          min_score: params.min_score || 0.0,
          include_metadata: params.include_metadata ?? true,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'RAG query failed' }));
        return NextResponse.json(error, { status: response.status });
      }

      return NextResponse.json(await response.json());
    }

    if (action === 'health') {
      const response = await fetch(`${RAG_ENDPOINT}/health`, { headers });

      if (!response.ok) {
        return NextResponse.json({ status: 'offline' });
      }

      return NextResponse.json(await response.json());
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('RAG proxy error:', error);
    return NextResponse.json(
      { status: 'offline', error: error instanceof Error ? error.message : 'Connection failed' },
      { status: 502 }
    );
  }
}

export async function GET() {
  // Health check endpoint
  try {
    const headers: Record<string, string> = {};
    if (RAG_API_KEY) {
      headers['Authorization'] = `Bearer ${RAG_API_KEY}`;
    }

    const response = await fetch(`${RAG_ENDPOINT}/health`, { headers });

    if (!response.ok) {
      return NextResponse.json({ status: 'offline' });
    }

    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json({ status: 'offline' });
  }
}
