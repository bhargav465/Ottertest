import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getMeeting, updateMeeting } from "./shared/dynamo";
import {
  ok,
  notFound,
  badRequest,
  serverError,
  getUserId,
} from "./shared/http";

const BUCKET = process.env.MEDIA_BUCKET!;
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

/**
 * POST /meetings/{meetingId}/retranscribe
 * Re-runs the transcription pipeline for a meeting (e.g. after a transient
 * Deepgram/Groq failure). Transcription takes minutes — far beyond an API
 * timeout — so instead of running it inline we self-copy the audio object in
 * S3, which re-fires the ObjectCreated notification that drives the normal
 * async pipeline.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return badRequest("meetingId is required");

    const meeting = await getMeeting(userId, meetingId);
    if (!meeting || !meeting.audioKey) return notFound("Meeting not found");

    if (meeting.status === "TRANSCRIBING" || meeting.status === "SUMMARIZING") {
      return badRequest("This meeting is already being processed.");
    }

    // Make sure the recording still exists before promising a retry.
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: meeting.audioKey })
      );
    } catch {
      return badRequest(
        "The recording for this meeting no longer exists, so it can't be retried."
      );
    }

    await updateMeeting(userId, meetingId, {
      status: "TRANSCRIBING",
      error: null, // clear the stale failure message
      updatedAt: new Date().toISOString(),
    });

    // Self-copy (REPLACE directive is required for same-key copies) →
    // s3:ObjectCreated:Copy fires → TranscribeFn picks it up again.
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: meeting.audioKey,
        CopySource: `${BUCKET}/${meeting.audioKey}`,
        MetadataDirective: "REPLACE",
      })
    );

    return ok({ retried: true });
  } catch (err) {
    console.error("retranscribe error", err);
    return serverError();
  }
}
