import { NextRequest } from 'next/server';

const GRAFANA_URL = process.env.GRAFANA_URL || 'http://localhost:3001';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '/';

  const targetUrl = `${GRAFANA_URL}${path}${url.search.replace('?path=', '?')}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
      },
    });

    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[GRAFANA PROXY ERROR]', error);
    return new Response(JSON.stringify({ error: 'Failed to connect to Grafana' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
