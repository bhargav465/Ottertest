import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { listMeetings } from "./shared/dynamo";
import { ok, serverError, getUserId, getUserEmail } from "./shared/http";

/**
 * GET /account/export
 * Returns all of the caller's data (every meeting with its full transcript and
 * summary) as JSON, so users can download a copy of everything we hold.
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const userId = getUserId(event);
    const meetings = await listMeetings(userId);
    return ok({
      account: { userId, email: getUserEmail(event) },
      meetingCount: meetings.length,
      meetings,
    });
  } catch (err) {
    console.error("exportAccount error", err);
    return serverError();
  }
}
