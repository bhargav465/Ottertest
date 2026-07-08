import type { MeetingSummary } from "./types";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_LLM_MODEL = process.env.GROQ_LLM_MODEL || "llama-3.3-70b-versatile";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Summaries are only produced when a Groq key is configured. */
export const summariesEnabled = () => GROQ_API_KEY.length > 0;

const SYSTEM_PROMPT = `You are an expert meeting assistant, similar to Otter.ai.
Given a meeting transcript (speaker-labelled), produce a concise, accurate
summary and extract action items.

Pay special attention to action items assigned to the meeting owner (first
person — "I", "I'll", "let me", "my task" — or their name/email if given). Mark
those with "mine": true so the owner sees what THEY need to do.

Respond with ONLY a JSON object of this exact shape:
{
  "tldr": "one or two sentence summary",
  "keyPoints": ["point", "..."],
  "decisions": ["decision", "..."],
  "actionItems": [
    { "task": "what to do", "owner": "You" | "<name>" | "Unassigned", "mine": true|false, "due": "optional due date or omit" }
  ]
}
Use empty arrays where a section has nothing. Never invent content that isn't
supported by the transcript.`;

async function groqChat(
  messages: Array<{ role: string; content: string }>,
  jsonMode: boolean,
  maxTokens: number
): Promise<string> {
  const res = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_LLM_MODEL,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq LLM ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function normalize(parsed: any): MeetingSummary {
  return {
    tldr: typeof parsed?.tldr === "string" ? parsed.tldr : "",
    keyPoints: Array.isArray(parsed?.keyPoints) ? parsed.keyPoints : [],
    decisions: Array.isArray(parsed?.decisions) ? parsed.decisions : [],
    actionItems: Array.isArray(parsed?.actionItems)
      ? parsed.actionItems.map((a: any) => ({
          task: String(a?.task ?? ""),
          owner: String(a?.owner ?? "Unassigned"),
          mine: Boolean(a?.mine),
          ...(a?.due ? { due: String(a.due) } : {}),
        }))
      : [],
  };
}

export async function summarizeTranscript(
  transcript: string,
  ownerHint?: string
): Promise<MeetingSummary> {
  const ownerLine = ownerHint
    ? `The meeting owner is identified as: ${ownerHint}. Treat their first-person statements and tasks addressed to them as "mine": true.\n\n`
    : "";
  const content = await groqChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${ownerLine}Here is the meeting transcript:\n\n"""\n${transcript}\n"""`,
      },
    ],
    true,
    2000
  );
  return normalize(JSON.parse(content));
}

/** Generate a short, human-friendly meeting title from the transcript. */
export async function generateTitle(transcript: string): Promise<string> {
  try {
    const title = await groqChat(
      [
        {
          role: "system",
          content:
            "Generate a short, specific meeting title (max 8 words). Respond with only the title, no quotes.",
        },
        { role: "user", content: transcript.slice(0, 4000) },
      ],
      false,
      40
    );
    return (
      title.trim().replace(/^["']|["']$/g, "").slice(0, 100) ||
      "Untitled meeting"
    );
  } catch {
    return "Untitled meeting";
  }
}
