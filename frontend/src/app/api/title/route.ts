import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const API_KEY = process.env.API_KEY || '';

const BOX_TAGS_PATTERN = /<\|(?:begin|end)_of_box\|>/g;
const stripBoxTags = (text: string) => (text ? text.replace(BOX_TAGS_PATTERN, '') : text);

function cleanTitle(raw: string): string {
  let title = String(raw || '');
  
  // Remove thinking tags and their content (greedy)
  title = title.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '');
  title = title.replace(/<\/?think[^>]*>/gi, '');
  
  // Remove any remaining XML-like tags
  title = title.replace(/<[^>]+>/g, '');
  
  // Remove code blocks
  title = title.replace(/```[\s\S]*?```/g, '');
  title = title.replace(/`[^`]+`/g, '');
  
  // Remove markdown formatting
  title = title.replace(/\*\*([^*]+)\*\*/g, '$1');
  title = title.replace(/\*([^*]+)\*/g, '$1');
  title = title.replace(/^#+\s*/gm, '');
  
  // Remove common prefixes
  title = title.replace(/^(Title|Chat Title|Suggested Title|Here'?s? ?(a |the )?title):\s*/gi, '');
  title = title.replace(/^(User|Assistant|User message|Assistant reply):\s*/gi, '');
  
  // Remove quotes
  title = title.replace(/^["'`]+|["'`]+$/g, '');
  
  // Remove numbered list prefixes
  title = title.replace(/^\d+\.\s*/gm, '');
  
  // Get first non-empty line
  const lines = title.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  title = lines[0] || title;
  
  // Final trim and length limit
  title = title.trim().slice(0, 60);
  
  // If still looks like garbage, return empty
  if (title.startsWith('<') || title.startsWith('`') || title.length < 2) {
    return '';
  }
  
  return title;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const model = typeof body?.model === 'string' ? body.model : 'default';
    const user = typeof body?.user === 'string' ? body.user : '';
    const assistant = typeof body?.assistant === 'string' ? body.assistant : '';

    if (!user.trim()) {
      return NextResponse.json({ error: 'User text required' }, { status: 400 });
    }

    // Clean input text
    let promptUser = stripBoxTags(user);
    promptUser = promptUser.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '').trim();
    promptUser = promptUser.slice(0, 500);
    
    let promptAssistant = stripBoxTags(assistant);
    promptAssistant = promptAssistant.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, '').trim();
    promptAssistant = promptAssistant.slice(0, 500);

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
        temperature: 0.3,
        max_tokens: 15,
        messages: [
          {
            role: 'user',
            content: `Generate a 3-5 word title for this conversation. Reply with ONLY the title words, no quotes, no punctuation, no explanation.

User said: ${promptUser}

Assistant replied: ${promptAssistant.slice(0, 200)}

Title:`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Title API error:', errorText);
      return NextResponse.json({ title: 'New Chat' });
    }

    const data = (await response.json().catch(() => null)) as any;
    const rawContent = data?.choices?.[0]?.message?.content ?? '';
    
    const title = cleanTitle(rawContent);
    
    console.log('Title generation:', { raw: rawContent.slice(0, 100), cleaned: title });

    return NextResponse.json({ title: title || 'New Chat' });
  } catch (error) {
    console.error('Title generation error:', error);
    return NextResponse.json({ title: 'New Chat' });
  }
}
