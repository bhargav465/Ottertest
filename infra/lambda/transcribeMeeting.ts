import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getMeeting, updateMeeting } from "./shared/dynamo";
import { summarizeTranscript, generateTitle } from "./shared/bedrock";

const BUCKET = process.env.MEDIA_BUCKET!;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
// whisper-large-v3-turbo is Groq's cheapest + fastest speech model.
const GROQ_MODEL = process.env.GROQ_MODEL || "whisper-large-v3-turbo";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
// AI summarization is optional — see BEDROCK_ENABLED in the CDK stack.
const BEDROCK_ENABLED = process.env.BEDROCK_ENABLED === "true";

const s3 = new S3Client({});

/**
 * S3 ObjectCreated (prefix audio/) → transcribe the recording with Groq
 * (hosted Whisper) and store the transcript. Groq is synchronous, so this one
 * Lambda replaces the old start/poll two-step Amazon Transcribe pipeline.
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
      if (!GROQ_API_KEY) {
        throw new Error(
          "GROQ_API_KEY is not configured (add it as a GitHub secret and redeploy)"
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

      // Send it to Groq's Whisper endpoint (multipart form). fetch/FormData/Blob
      // are globals in the Node 20 runtime — no extra dependencies needed.
      const form = new FormData();
      form.append("file", new Blob([audio]), `audio.${ext}`);
      form.append("model", GROQ_MODEL);
      form.append("response_format", "json");

      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 300)}`);
      }

      const data = (await res.json()) as { text?: string };
      const transcript = (data.text || "").trim();

      if (!transcript) {
        await updateMeeting(userId, meetingId, {
          status: "FAILED",
          error: "Empty transcript (no speech detected)",
          transcript: "",
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      // Bedrock disabled: store the transcript and finish.
      if (!BEDROCK_ENABLED) {
        await updateMeeting(userId, meetingId, {
          status: "DONE",
          transcript,
          updatedAt: new Date().toISOString(),
        });
        console.log(`Transcribed meeting ${meetingId} (summarization disabled)`);
        continue;
      }

      // Optional AI summary + action items via Amazon Bedrock.
      const meeting = await getMeeting(userId, meetingId);
      await updateMeeting(userId, meetingId, {
        status: "SUMMARIZING",
        updatedAt: new Date().toISOString(),
      });
      const [summary, autoTitle] = await Promise.all([
        summarizeTranscript(transcript, meeting?.ownerEmail),
        meeting?.autoTitle ? generateTitle(transcript) : Promise.resolve(null),
      ]);
      await updateMeeting(userId, meetingId, {
        status: "DONE",
        transcript,
        summary,
        ...(autoTitle ? { title: autoTitle } : {}),
        updatedAt: new Date().toISOString(),
      });
      console.log(`Summarized meeting ${meetingId}`);
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
