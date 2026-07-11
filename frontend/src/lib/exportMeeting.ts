import type { Meeting } from "./api";

/** Apply saved speaker names to the raw "Speaker N:" transcript. */
export function transcriptWithNames(meeting: Meeting): string {
  const t = meeting.transcript ?? "";
  const map = meeting.speakerNames ?? {};
  if (!Object.keys(map).length) return t;
  return t
    .split("\n")
    .map((line) => {
      const m = line.match(/^(Speaker \d+): ?(.*)$/);
      return m ? `${map[m[1]] || m[1]}: ${m[2]}` : line;
    })
    .join("\n");
}

/** Render a meeting as a shareable Markdown document. */
export function meetingToMarkdown(meeting: Meeting): string {
  const lines: string[] = [];
  lines.push(`# ${meeting.title}`);

  const meta = [new Date(meeting.createdAt).toLocaleString()];
  if (meeting.durationSeconds) {
    meta.push(`${Math.round(meeting.durationSeconds / 60)} min`);
  }
  if (meeting.folder) meta.push(`Folder: ${meeting.folder}`);
  lines.push(`_${meta.join(" · ")}_`, "");

  const s = meeting.summary;
  if (s) {
    if (s.tldr) lines.push("## TL;DR", s.tldr, "");
    if (s.actionItems?.length) {
      lines.push("## Action items");
      for (const a of s.actionItems) {
        const who = a.mine ? "You" : a.owner;
        const due = a.due ? ` (due ${a.due})` : "";
        lines.push(`- [ ] ${a.task} — ${who}${due}`);
      }
      lines.push("");
    }
    if (s.keyPoints?.length) {
      lines.push("## Key points", ...s.keyPoints.map((p) => `- ${p}`), "");
    }
    if (s.decisions?.length) {
      lines.push("## Decisions", ...s.decisions.map((d) => `- ${d}`), "");
    }
  }

  const transcript = transcriptWithNames(meeting).trim();
  if (transcript) lines.push("## Transcript", transcript, "");

  return lines.join("\n");
}

/** Trigger a client-side download of a text file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe slug for the title. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "meeting"
  );
}
