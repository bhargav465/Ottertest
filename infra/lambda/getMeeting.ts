import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { getMeeting } from "./shared/dynamo";
import { ok, notFound, badRequest, serverError, getUserId } from "./shared/http";

/**
 * GET /meetings/{meetingId}
 * Returns a single meeting (including full transcript + summary) for the owner.
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

    return ok({ meeting });
  } catch (err) {
    console.error("getMeeting error", err);
    return serverError();
  }
}
