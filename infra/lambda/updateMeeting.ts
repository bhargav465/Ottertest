import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getMeeting, updateMeeting } from "./shared/dynamo";
import {
  ok,
  notFound,
  badRequest,
  serverError,
  getUserId,
  parseBody,
} from "./shared/http";
import type { Meeting } from "./shared/types";

interface UpdateBody {
  /** Folder to file under. "" or null clears the folder (unfiled). */
  folder?: string | null;
  /** Optional rename. */
  title?: string;
}

const MAX_FOLDER = 60;
const MAX_TITLE = 200;

/**
 * PATCH /meetings/{meetingId}
 * Update user-editable metadata on a meeting — currently its folder and title.
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

    const body = parseBody<UpdateBody>(event.body);
    const fields: Partial<Record<keyof Meeting, unknown>> = {};

    if (body.folder !== undefined) {
      const folder = (body.folder ?? "").trim().slice(0, MAX_FOLDER);
      // Empty → remove the attribute (unfiled).
      fields.folder = folder.length ? folder : null;
    }

    if (typeof body.title === "string") {
      const title = body.title.trim().slice(0, MAX_TITLE);
      if (title.length) {
        fields.title = title;
        fields.autoTitle = false;
      }
    }

    if (Object.keys(fields).length === 0) {
      return badRequest("Nothing to update");
    }

    fields.updatedAt = new Date().toISOString();
    await updateMeeting(userId, meetingId, fields);

    const updated = await getMeeting(userId, meetingId);
    return ok({ meeting: updated });
  } catch (err) {
    console.error("updateMeeting error", err);
    return serverError();
  }
}
