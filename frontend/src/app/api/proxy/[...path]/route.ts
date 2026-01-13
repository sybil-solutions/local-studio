import { NextRequest, NextResponse } from 'next/server';
import { getApiSettings } from '@/lib/api-settings';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'GET', path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'POST', path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'PUT', path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleRequest(request, 'DELETE', path);
}

function getClientInfo(request: NextRequest) {
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
             request.headers.get('X-Real-IP') ||
             'unknown';
  const country = request.headers.get('CF-IPCountry') || '-';
  const ua = request.headers.get('User-Agent')?.slice(0, 80) || 'unknown';
  return { ip, country, ua };
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);

  try {
    // Get dynamic settings
    const settings = await getApiSettings();
    const BACKEND_URL = settings.backendUrl;
    const API_KEY = settings.apiKey;

    const url = new URL(request.url);
    const searchParams = url.searchParams.toString();
    const targetUrl = `${BACKEND_URL}/${path.join('/')}${searchParams ? `?${searchParams}` : ''}`;
    const hasAuth = Boolean(request.headers.get('authorization'));

    console.log(`[PROXY] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join('/')} | backend=${BACKEND_URL} | auth=${hasAuth ? 'present' : 'none'}`);

    const headers: HeadersInit = {
      ...(request.headers.get('accept') ? { Accept: request.headers.get('accept') as string } : {}),
    };

    const incomingContentType = request.headers.get('content-type');
    if (incomingContentType) headers['Content-Type'] = incomingContentType;

    // Prefer per-user Authorization header passed from the browser; fallback to configured API key.
    const incomingAuth = request.headers.get('authorization');
    if (incomingAuth) {
      headers['Authorization'] = incomingAuth;
    } else if (API_KEY) {
      headers['Authorization'] = `Bearer ${API_KEY}`;
    }

    const body = method !== 'GET' && method !== 'DELETE' 
      ? await request.text() 
      : undefined;

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const contentType = response.headers.get('content-type') || 'application/json';

    if (contentType.includes('text/event-stream') && response.body) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': response.headers.get('cache-control') || 'no-cache',
        },
      });
    }

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[PROXY ERROR] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join('/')} | duration=${duration}ms | error=${String(error)}`);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
