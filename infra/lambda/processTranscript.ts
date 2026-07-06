import type { EventBridgeEvent } from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { findMeetingById, updateMeeting } from "./shared/dynamo";
import { summarizeTranscript, generateTitle } from "./shared/bedrock";

const BUCKET = process.env.MEDIA_BUCKET!;
const s3 = new S3Client({});

interface TranscribeJobDetail {
  TranscriptionJobName: string;
  TranscriptionJobStatus: "COMPLETED" | "FAILED";
}

/** Turn raw Amazon Transcribe output into readable, speaker-labelled text. */
function buildTranscript(doc: any): string {
  const results = doc?.results;
  if (!results) return "";
  const plain: string = results.transcripts?.[0]?.transcript ?? "";

  const segments = results.speaker_labels?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return plain;
  }

  // Map each item's start_time to a speaker label.
  const speakerAt = new Map<string, string>();
  for (const seg of segments) {
    for (const it of seg.items ?? []) {
      speakerAt.set(it.start_time, seg.speaker_label);
    }
  }

  const lines: string[] = [];
  let currentSpeaker = "";
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length) {
      const label = currentSpeaker
        ? currentSpeaker.replace("spk_", "Speaker ")
        : "Speaker";
      lines.push(`${label}: ${buffer.join(" ").replace(/\s+([.,!?])/g, "$1")}`);
      buffer = [];
    }
  };

  for (const item of results.items ?? []) {
    const content = item.alternatives?.[0]?.content;
    if (!content) continue;
    if (item.type === "punctuation") {
      if (buffer.length) buffer[buffer.length - 1] += content;
      continue;
    }
    const speaker = speakerAt.get(item.start_time) ?? currentSpeaker;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    buffer.push(content);
  }
  flush();

  return lines.length ? lines.join("\n") : plain;
}

/**
 * EventBridge "Transcribe Job State Change" → summarize with Bedrock and persist.
 */
export async function handler(
  event: EventBridgeEvent<"Transcribe Job State Change", TranscribeJobDetail>
): Promise<void> {
  const jobName = event.detail.TranscriptionJobName;
  const status = event.detail.TranscriptionJobStatus;

  const meeting = await findMeetingById(jobName);
  if (!meeting) {
    console.warn(`No meeting found for transcription job ${jobName}`);
    return;
  }
  const { userId, meetingId } = meeting;

  if (status === "FAILED") {
    await updateMeeting(userId, meetingId, {
      status: "FAILED",
      error: "Transcription failed",
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateMeeting(userId, meetingId, {
      status: "SUMMARIZING",
      updatedAt: new Date().toISOString(),
    });

    // Read the transcript JSON we told Transcribe to write.
    const transcriptKey =
      meeting.transcriptKey ?? `transcripts/${meetingId}.json`;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: transcriptKey })
    );
    const raw = await obj.Body!.transformToString();
    const transcript = buildTranscript(JSON.parse(raw));

    if (!transcript.trim()) {
      await updateMeeting(userId, meetingId, {
        status: "FAILED",
        error: "Empty transcript (no speech detected)",
        transcript: "",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const [summary, autoTitle] = await Promise.all([
      summarizeTranscript(transcript, meeting.ownerEmail),
      meeting.autoTitle ? generateTitle(transcript) : Promise.resolve(null),
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
    console.error(`Failed to process transcript for ${meetingId}`, err);
    await updateMeeting(userId, meetingId, {
      status: "FAILED",
      error: "Failed to summarize transcript",
      updatedAt: new Date().toISOString(),
    });
  }
}
