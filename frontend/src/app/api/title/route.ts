// CRITICAL
import { NextRequest, NextResponse } from "next/server";
import { getMessageParsingService } from "@/lib/services/message-parsing";
import { getApiSettings } from "@/lib/api-settings";

// Common stop words to filter out when generating simple titles
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "can", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "about", "what", "which", "who", "whom",
  "this", "that", "these", "those", "am", "and", "or", "but", "if", "then",
  "so", "than", "too", "very", "just", "also", "now", "here", "there", "when",
  "where", "why", "how", "all", "each", "every", "both", "few", "more", "most",
  "some", "any", "no", "not", "only", "own", "same", "such", "your", "my",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "please", "can", "could", "would", "help", "want", "need", "like", "tell",
  "hey", "hi", "hello", "thanks", "thank", "okay", "ok", "yes", "yeah", "sure"
]);

/**
 * Generate a simple title from the user's message by extracting key words
 */
function generateSimpleTitle(userMessage: string): string {
  // Clean the message
  const cleaned = userMessage
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Extract meaningful words
  const words = cleaned.split(" ").filter(
    (word) => word.length > 2 && !STOP_WORDS.has(word)
  );

  // Take first 4-5 meaningful words
  const titleWords = words.slice(0, 5);

  if (titleWords.length === 0) {
    return "New Chat";
  }

  // Capitalize first letter of each word
  const title = titleWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return title.slice(0, 50);
}

function cleanTitle(raw: string): string {
  let title = String(raw || "");

  // First, try to extract content from thinking tags (model might wrap title in thinking)
  const thinkMatch = title.match(/<think[^>]*>([\s\S]*?)<\/think[^>]*>/i);
  if (thinkMatch) {
    const thinkContent = thinkMatch[1].trim();
    const afterThink = title.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/gi, "").trim();
    // Prefer content after thinking tags, fall back to inside if nothing after
    title = afterThink || thinkContent;
  }

  // Remove any remaining incomplete thinking tags
  title = title.replace(/<\/?think[^>]*>/gi, "");

  // Remove any remaining XML-like tags
  title = title.replace(/<[^>]+>/g, "");

  // Remove code blocks
  title = title.replace(/```[\s\S]*?```/g, "");
  title = title.replace(/`[^`]+`/g, "");

  // Remove markdown formatting
  title = title.replace(/\*\*([^*]+)\*\*/g, "$1");
  title = title.replace(/\*([^*]+)\*/g, "$1");
  title = title.replace(/^#+\s*/gm, "");

  // Remove common prefixes from reasoning models
  title = title.replace(/^(Title|Chat Title|Suggested Title|Here'?s? ?(a |the )?title):\s*/gi, "");
  title = title.replace(/^(User|Assistant|User message|Assistant reply):\s*/gi, "");
  title = title.replace(/^(Output|Answer|Result|Final|Summary):\s*/gi, "");
  title = title.replace(/^(Analyze|Analysis|Let me|I will|First|The title).*?:/gi, "");

  // Remove quotes
  title = title.replace(/^["'`]+|["'`]+$/g, "");

  // Remove numbered list prefixes
  title = title.replace(/^\d+\.\s*/gm, "");

  // Get lines and try to find the best candidate
  const lines = title
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length < 80);

  // For reasoning models, the actual title is often the last short line
  // Look for a line that looks like a title (3-8 words, no special chars at start)
  const titleCandidates = lines.filter((l) => {
    const wordCount = l.split(/\s+/).length;
    return wordCount >= 2 && wordCount <= 10 && !/^[*\-•\d]/.test(l) && !/^\w+:/.test(l);
  });

  // Prefer the last candidate (reasoning models often conclude with the answer)
  title = titleCandidates[titleCandidates.length - 1] || lines[lines.length - 1] || lines[0] || title;

  // Final cleanup
  title = title.replace(/^["'`]+|["'`]+$/g, "").trim();

  // Final trim and length limit
  title = title.slice(0, 60);

  // If still looks like garbage, return empty
  if (title.startsWith("<") || title.startsWith("`") || title.length < 2) {
    return "";
  }

  return title;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const model = typeof body?.model === "string" ? body.model : "default";
    const user = typeof body?.user === "string" ? body.user : "";
    const assistant = typeof body?.assistant === "string" ? body.assistant : "";

    if (!user.trim()) {
      return NextResponse.json({ error: "User text required" }, { status: 400 });
    }

    // Clean input text using service
    const parsingService = getMessageParsingService();
    const userThinking = parsingService.parseThinking(user);
    const promptUser = userThinking.mainContent.slice(0, 500);

    const assistantThinking = parsingService.parseThinking(assistant);
    const promptAssistant = assistantThinking.mainContent.slice(0, 500);

    const { backendUrl, apiKey } = await getApiSettings();
    const incomingAuth = req.headers.get("authorization");
    const normalizedToken = incomingAuth ? incomingAuth.replace(/^Bearer\s+/i, "").trim() : "";
    const effectiveKey = normalizedToken || apiKey || "sk-master";

    const systemPrompt = "You are a title generator. Output ONLY a 3-5 word title. No explanation, no quotes, no punctuation, no thinking - just the title words.";
    const userPrompt = `Title this chat:\nUser: "${promptUser.slice(0, 100)}"\nAssistant: "${promptAssistant.slice(0, 100)}"`;

    // Use direct fetch to handle reasoning models that put output in reasoning_content
    const response = await fetch(`${backendUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.error("Title generation API error:", response.status);
      return NextResponse.json({ title: "New Chat" });
    }

    const data = await response.json();
    const choice = data.choices?.[0]?.message;

    // Handle both regular content and reasoning model format
    const rawContent = choice?.content || "";

    // For reasoning models that put content in reasoning_content,
    // skip trying to extract - just use the simple title generator
    // The reasoning typically contains thinking steps, not the actual answer

    console.log("Title generation raw:", JSON.stringify(rawContent.slice(0, 200)));

    let title = cleanTitle(rawContent);

    // If still no title, generate from the user's message
    if (!title || title === "New Chat") {
      title = generateSimpleTitle(promptUser);
    }

    console.log("Title generation final:", JSON.stringify(title));

    return NextResponse.json({ title: title || "New Chat" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Title generation error:", errorMessage);
    // Return error info in development for debugging
    if (process.env.NODE_ENV === "development") {
      return NextResponse.json({ title: "New Chat", debug: errorMessage });
    }
    return NextResponse.json({ title: "New Chat" });
  }
}
