import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getMeeting, deleteMeeting } from "./shared/dynamo";
import { ok, notFound, badRequest, serverError, getUserId } from "./shared/http";

const BUCKET = process.env.MEDIA_BUCKET!;
const s3 = new S3Client({});

/**
 * DELETE /meetings/{meetingId}
 * Removes the meeting record and its audio/transcript objects from S3.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetingId = event.pathParameters?.meetingId;
    if (!meetingId) return badRequest("meetingId is required");

    const meeting = await getMeeting(userId, meetingId);
    if (!meeting) return notFound("Meeting not found");

    // Best-effort cleanup of S3 objects.
    const keys = [meeting.audioKey, meeting.transcriptKey].filter(
      Boolean
    ) as string[];
    await Promise.allSettled(
      keys.map((Key) =>
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key }))
      )
    );

    await deleteMeeting(userId, meetingId);
    return ok({ deleted: meetingId });
  } catch (err) {
    console.error("deleteMeeting error", err);
    return serverError();
  }
}
