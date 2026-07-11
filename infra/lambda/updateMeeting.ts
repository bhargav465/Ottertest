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
  /** Map of speaker label → custom name, e.g. { "Speaker 1": "Matt" }. */
  speakerNames?: Record<string, string> | null;
}

const MAX_FOLDER = 60;
const MAX_TITLE = 200;
const MAX_SPEAKER_NAME = 60;
const MAX_SPEAKERS = 40;

/** Keep only sane "Speaker N" → non-empty-name entries; trims + caps sizes. */
function cleanSpeakerNames(
  input: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, name] of Object.entries(input)) {
    if (Object.keys(out).length >= MAX_SPEAKERS) break;
    if (!/^Speaker \d+$/.test(label)) continue;
    if (typeof name !== "string") continue;
    const clean = name.trim().slice(0, MAX_SPEAKER_NAME);
    if (clean) out[label] = clean;
  }
  return out;
}

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

    if (body.speakerNames !== undefined) {
      const cleaned = body.speakerNames
        ? cleanSpeakerNames(body.speakerNames)
        : {};
      // Empty map → remove the attribute entirely (back to plain Speaker N).
      fields.speakerNames = Object.keys(cleaned).length ? cleaned : null;
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
