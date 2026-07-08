import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getMeeting, updateMeeting } from "./shared/dynamo";
import {
  summarizeTranscript,
  generateTitle,
  summariesEnabled,
} from "./shared/summarize";

const BUCKET = process.env.MEDIA_BUCKET!;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL || "nova-2";

const s3 = new S3Client({});

const MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  speaker?: number;
}

/** Build a speaker-labelled transcript from Deepgram's diarized words. */
function buildTranscript(data: any): string {
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return "";
  const words: DeepgramWord[] = alt.words ?? [];
  if (words.length === 0) return (alt.transcript ?? "").trim();

  const lines: string[] = [];
  let currentSpeaker: number | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length) {
      const label =
        currentSpeaker === undefined
          ? "Speaker"
          : `Speaker ${currentSpeaker + 1}`;
      lines.push(`${label}: ${buffer.join(" ")}`);
      buffer = [];
    }
  };

  for (const w of words) {
    const speaker = w.speaker ?? 0;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    buffer.push(w.punctuated_word ?? w.word);
  }
  flush();

  return lines.length ? lines.join("\n") : (alt.transcript ?? "").trim();
}

/**
 * S3 ObjectCreated (prefix audio/) → transcribe the recording with Deepgram
 * (Nova-2, speaker diarization) and store the speaker-labelled transcript.
 * Deepgram is synchronous, so one Lambda covers the whole pipeline.
 * Key layout: audio/{userId}/{meetingId}.{ext}
 */
export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const match = key.match(/^audio\/([^/]+)\/([^/]+)\.([^.]+)$/);
    if (!match) {
      console.warn("Skipping unrecognized audio key:", key);
      continue;
    }
    const [, userId, meetingId, ext] = match;

    try {
      if (!DEEPGRAM_API_KEY) {
        throw new Error(
          "DEEPGRAM_API_KEY is not configured (add it as a GitHub secret and redeploy)"
        );
      }

      await updateMeeting(userId, meetingId, {
        status: "TRANSCRIBING",
        updatedAt: new Date().toISOString(),
      });

      // Download the recording from S3.
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key })
      );
      const audio = await obj.Body!.transformToByteArray();

      // Send raw audio to Deepgram with diarization + smart formatting.
      const params = new URLSearchParams({
        model: DEEPGRAM_MODEL,
        diarize: "true",
        smart_format: "true",
        punctuate: "true",
      });
      const contentType = MIME_BY_EXT[ext.toLowerCase()] ?? "audio/webm";
      const res = await fetch(
        `https://api.deepgram.com/v1/listen?${params.toString()}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${DEEPGRAM_API_KEY}`,
            "Content-Type": contentType,
          },
          body: audio,
        }
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Deepgram API ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = await res.json();
      const transcript = buildTranscript(data);

      if (!transcript.trim()) {
        await updateMeeting(userId, meetingId, {
          status: "FAILED",
          error: "Empty transcript (no speech detected)",
          transcript: "",
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      // No summary key configured: store the transcript and finish.
      if (!summariesEnabled()) {
        await updateMeeting(userId, meetingId, {
          status: "DONE",
          transcript,
          updatedAt: new Date().toISOString(),
        });
        console.log(`Transcribed meeting ${meetingId} (summaries disabled)`);
        continue;
      }

      // AI summary + action items via Groq (Llama). If it fails, still keep the
      // transcript — don't fail the whole meeting over a summary hiccup.
      const meeting = await getMeeting(userId, meetingId);
      await updateMeeting(userId, meetingId, {
        status: "SUMMARIZING",
        updatedAt: new Date().toISOString(),
      });
      try {
        const [summary, autoTitle] = await Promise.all([
          summarizeTranscript(transcript, meeting?.ownerEmail),
          meeting?.autoTitle
            ? generateTitle(transcript)
            : Promise.resolve(null),
        ]);
        await updateMeeting(userId, meetingId, {
          status: "DONE",
          transcript,
          summary,
          ...(autoTitle ? { title: autoTitle } : {}),
          updatedAt: new Date().toISOString(),
        });
        console.log(`Summarized meeting ${meetingId}`);
      } catch (summaryErr) {
        console.error(`Summary failed for ${meetingId}`, summaryErr);
        await updateMeeting(userId, meetingId, {
          status: "DONE",
          transcript,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error(`Failed to transcribe ${key}`, err);
      const detail = err instanceof Error ? err.message : String(err);
      await updateMeeting(userId, meetingId, {
        status: "FAILED",
        error: `Transcription failed: ${detail}`,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
