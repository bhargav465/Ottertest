import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getMeeting } from "./shared/dynamo";
import { ok, notFound, badRequest, serverError, getUserId } from "./shared/http";

const BUCKET = process.env.MEDIA_BUCKET!;
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

/**
 * GET /meetings/{meetingId}/audio
 * Returns a short-lived presigned URL to stream/download the recording, so the
 * owner can play it back next to the transcript.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return badRequest("meetingId is required");

    const meeting = await getMeeting(userId, meetingId);
    if (!meeting || !meeting.audioKey) return notFound("Recording not found");

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: meeting.audioKey }),
      { expiresIn: 3600 } // 1 hour
    );

    return ok({ url });
  } catch (err) {
    console.error("getAudioUrl error", err);
    return serverError();
  }
}
