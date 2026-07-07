import type { S3Event } from "aws-lambda";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  MediaFormat,
  LanguageCode,
} from "@aws-sdk/client-transcribe";
import { updateMeeting } from "./shared/dynamo";

const BUCKET = process.env.MEDIA_BUCKET!;
// A fixed language is required to combine with speaker labels — Amazon Transcribe
// rejects ShowSpeakerLabels together with automatic language identification.
// Override per deploy with TRANSCRIBE_LANGUAGE (e.g. en-GB, es-ES, hi-IN).
const LANGUAGE_CODE =
  (process.env.TRANSCRIBE_LANGUAGE as LanguageCode) || LanguageCode.EN_US;
const transcribe = new TranscribeClient({});

const FORMAT_BY_EXT: Record<string, MediaFormat> = {
  webm: MediaFormat.WEBM,
  mp4: MediaFormat.MP4,
  m4a: MediaFormat.MP4,
  mp3: MediaFormat.MP3,
  wav: MediaFormat.WAV,
  flac: MediaFormat.FLAC,
  ogg: MediaFormat.OGG,
};

/**
 * S3 ObjectCreated (prefix audio/) → start an Amazon Transcribe job.
 * Key layout: audio/{userId}/{meetingId}.{ext}
 */
export async function handler(event: S3Event): Promise<void> {
  for (const record of event.Records) {
    const key = decodeURIComponent(
      record.s3.object.key.replace(/\+/g, " ")
    );
    const match = key.match(/^audio\/([^/]+)\/([^/]+)\.([^.]+)$/);
    if (!match) {
      console.warn("Skipping unrecognized audio key:", key);
      continue;
    }
    const [, userId, meetingId, ext] = match;
    const mediaFormat = FORMAT_BY_EXT[ext.toLowerCase()] ?? MediaFormat.WEBM;
    const transcriptKey = `transcripts/${meetingId}.json`;

    try {
      await transcribe.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: meetingId,
          LanguageCode: LANGUAGE_CODE,
          MediaFormat: mediaFormat,
          Media: { MediaFileUri: `s3://${BUCKET}/${key}` },
          OutputBucketName: BUCKET,
          OutputKey: transcriptKey,
          Settings: {
            ShowSpeakerLabels: true,
            MaxSpeakerLabels: 10,
          },
        })
      );

      await updateMeeting(userId, meetingId, {
        status: "TRANSCRIBING",
        transcriptJobName: meetingId,
        transcriptKey,
        updatedAt: new Date().toISOString(),
      });
      console.log(`Started transcription job ${meetingId}`);
    } catch (err) {
      console.error(`Failed to start transcription for ${meetingId}`, err);
      // Surface the real AWS error so the UI shows something actionable.
      const detail = err instanceof Error ? err.message : String(err);
      await updateMeeting(userId, meetingId, {
        status: "FAILED",
        error: `Failed to start transcription: ${detail}`,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
