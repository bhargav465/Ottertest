import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { MeetingSummary } from "./types";

const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-5-sonnet-20240620-v1:0";

const client = new BedrockRuntimeClient({});

const SYSTEM_PROMPT = `You are an expert meeting assistant, similar to Otter.ai.
You are given the raw transcript of a meeting. Produce a concise, accurate
summary and extract action items.

Pay special attention to action items assigned to the meeting owner (referred to
in first person: "I", "I'll", "let me", "my task", or by the owner's name/email
if provided). Mark those with "mine": true so the owner can see what THEY need to
do.

Respond with ONLY a valid JSON object (no markdown, no commentary) of this exact shape:
{
  "tldr": "one or two sentence summary",
  "keyPoints": ["point", "..."],
  "decisions": ["decision", "..."],
  "actionItems": [
    { "task": "what to do", "owner": "You" | "<name>" | "Unassigned", "mine": true|false, "due": "optional due date or omit" }
  ]
}
If a section has nothing, use an empty array. Never invent content not supported
by the transcript.`;

/** Robustly pull the first JSON object out of a model response. */
function extractJson(text: string): MeetingSummary {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in model output");
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  return {
    tldr: parsed.tldr ?? "",
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.map((a: any) => ({
          task: String(a.task ?? ""),
          owner: String(a.owner ?? "Unassigned"),
          mine: Boolean(a.mine),
          ...(a.due ? { due: String(a.due) } : {}),
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

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 2000,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${ownerLine}Here is the meeting transcript:\n\n"""\n${transcript}\n"""`,
          },
        ],
      },
    ],
  };

  const res = await client.send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(body),
    })
  );

  const decoded = JSON.parse(new TextDecoder().decode(res.body));
  const text: string = decoded?.content?.[0]?.text ?? "";
  return extractJson(text);
}

/** Generate a short human-friendly meeting title from the transcript. */
export async function generateTitle(transcript: string): Promise<string> {
  const snippet = transcript.slice(0, 4000);
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 40,
    temperature: 0.3,
    system:
      "Generate a short, specific meeting title (max 8 words) for the transcript. Respond with only the title, no quotes.",
    messages: [{ role: "user", content: [{ type: "text", text: snippet }] }],
  };
  try {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(body),
      })
    );
    const decoded = JSON.parse(new TextDecoder().decode(res.body));
    const title: string = decoded?.content?.[0]?.text ?? "";
    return title.trim().replace(/^["']|["']$/g, "").slice(0, 100) || "Untitled meeting";
  } catch {
    return "Untitled meeting";
  }
}
