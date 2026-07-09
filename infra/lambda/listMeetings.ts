import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { listMeetings } from "./shared/dynamo";
import { ok, serverError, getUserId } from "./shared/http";

/**
 * GET /meetings
 * Returns the caller's meetings, newest first. Heavy fields (full transcript)
 * are stripped to keep the list response small.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetings = await listMeetings(userId);

    const items = meetings.map((m) => ({
      meetingId: m.meetingId,
      title: m.title,
      status: m.status,
      folder: m.folder,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      durationSeconds: m.durationSeconds,
      tldr: m.summary?.tldr,
      actionItemCount: m.summary?.actionItems?.length ?? 0,
      myActionItemCount:
        m.summary?.actionItems?.filter((a) => a.mine).length ?? 0,
    }));

    return ok({ meetings: items });
  } catch (err) {
    console.error("listMeetings error", err);
    return serverError();
  }
}
