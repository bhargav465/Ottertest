import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  S3Client,
  DeleteObjectsCommand,
  type ObjectIdentifier,
} from "@aws-sdk/client-s3";
import { listMeetings, deleteMeeting } from "./shared/dynamo";
import { ok, serverError, getUserId } from "./shared/http";

const BUCKET = process.env.MEDIA_BUCKET!;
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

/**
 * DELETE /account
 * Permanently deletes all of the caller's data: every meeting record in
 * DynamoDB and its audio/transcript objects in S3. The frontend deletes the
 * Cognito user separately (client-side) after this succeeds.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetings = await listMeetings(userId);

    // Remove S3 objects in batches of up to 1000.
    const keys: ObjectIdentifier[] = [];
    for (const m of meetings) {
      if (m.audioKey) keys.push({ Key: m.audioKey });
      if (m.transcriptKey) keys.push({ Key: m.transcriptKey });
    }
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch, Quiet: true },
        })
      );
    }

    // Remove all DynamoDB records for this user.
    await Promise.all(
      meetings.map((m) => deleteMeeting(userId, m.meetingId))
    );

    return ok({ deletedMeetings: meetings.length });
  } catch (err) {
    console.error("deleteAccount error", err);
    return serverError();
  }
}
