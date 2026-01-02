import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || '';

const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const model = typeof body?.model === 'string' ? body.model : 'default';
    const user = typeof body?.user === 'string' ? body.user : '';
    const assistant = typeof body?.assistant === 'string' ? body.assistant : '';

    if (!user.trim()) {
      return NextResponse.json({ error: 'User text required' }, { status: 400 });
    }

    const promptUser = stripBoxTags(user).slice(0, 800);
    const promptAssistant = stripBoxTags(assistant).slice(0, 800);

    const incomingAuth = req.headers.get('authorization');
    const outgoingAuth = incomingAuth || (API_KEY ? `Bearer ${API_KEY}` : undefined);

    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(outgoingAuth ? { Authorization: outgoingAuth } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.2,
        max_tokens: 24,
        messages: [
          {
            role: 'system',
            content:
              'Generate a short, specific chat title (max 6 words). Return ONLY the title text. No reasoning, no explanations, no quotes, no punctuation at the end. Just the title.',
          },
          {
            role: 'user',
            content: `User message:\n${promptUser}\n\nAssistant reply:\n${promptAssistant}`.trim(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: errorText || `HTTP ${response.status}` }, { status: 500 });
    }

    const data = (await response.json().catch(() => null)) as any;
    let titleRaw = data?.choices?.[0]?.message?.content ?? '';
    
    // Strip any reasoning/thinking content that might be included
    titleRaw = String(titleRaw)
      .replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '')
      .replace(/\*\*.*?\*\*/g, '')
      .replace(/^\d+\.\s*/gm, '')
      .replace(/^[\s\S]*?Title:\s*/i, '')
      .replace(/^(User|Assistant|User message|Assistant reply):\s*/gi, '');
    
    // Get the last non-empty line without asterisks
    const lines = titleRaw.split('\n').filter((line: string) => line.trim() && !line.includes('*'));
    titleRaw = lines.pop() || titleRaw;
    
    // Final cleanup: strip quotes and truncate
    const title = String(titleRaw)
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(User|Assistant|User message|Assistant reply):\s*/gi, '')
      .slice(0, 80);

    return NextResponse.json({ title: title || 'New Chat' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
