import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { putMeeting } from "./shared/dynamo";
import {
  created,
  serverError,
  getUserId,
  getUserEmail,
  parseBody,
} from "./shared/http";
import type { Meeting } from "./shared/types";

const BUCKET = process.env.MEDIA_BUCKET!;
// `requestChecksumCalculation: "WHEN_REQUIRED"` is essential here. Newer AWS SDK
// versions (which the Lambda runtime periodically upgrades to) default to
// "WHEN_SUPPORTED", which bakes an `x-amz-checksum-crc32` of an *empty* body
// into presigned PUT URLs. The browser then PUTs the real audio, S3 recomputes
// the checksum, it doesn't match, and the upload is rejected — so recordings
// silently fail to save. Forcing "WHEN_REQUIRED" keeps the URL checksum-free.
const s3 = new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED" });

interface CreateUploadBody {
  title?: string;
  contentType?: string;
  durationSeconds?: number;
}

/**
 * POST /uploads
 * Reserves a meeting record and returns a short-lived presigned S3 URL the
 * browser can PUT the recorded audio to. The S3 ObjectCreated event then kicks
 * off transcription automatically.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const body = parseBody<CreateUploadBody>(event.body);

    const contentType = body.contentType ?? "audio/webm";
    const ext = contentType.includes("mp4")
      ? "mp4"
      : contentType.includes("wav")
        ? "wav"
        : contentType.includes("mpeg") || contentType.includes("mp3")
          ? "mp3"
          : "webm";

    // Time-sortable id → newest-first listing via ScanIndexForward:false.
    const meetingId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const audioKey = `audio/${userId}/${meetingId}.${ext}`;
    const now = new Date().toISOString();

    const hasTitle = Boolean(body.title?.trim());
    const meeting: Meeting = {
      userId,
      meetingId,
      ownerEmail: getUserEmail(event),
      title: hasTitle
        ? body.title!.trim()
        : `Meeting ${new Date().toLocaleString()}`,
      autoTitle: !hasTitle,
      status: "UPLOADING",
      createdAt: now,
      updatedAt: now,
      audioKey,
      durationSeconds: body.durationSeconds,
    };
    await putMeeting(meeting);

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: audioKey,
        ContentType: contentType,
        // Stash the owner's email so the transcription job (and later Bedrock)
        // can attribute first-person action items to them.
        Metadata: getUserEmail(event) ? { owner: getUserEmail(event)! } : {},
      }),
      { expiresIn: 900 } // 15 minutes
    );

    return created({ meetingId, uploadUrl, audioKey, contentType });
  } catch (err) {
    console.error("createUploadUrl error", err);
    return serverError();
  }
}
