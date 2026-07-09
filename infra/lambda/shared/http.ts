import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
};

export function json(
  statusCode: number,
  body: unknown
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);
export const badRequest = (message: string) => json(400, { message });
export const notFound = (message = "Not found") => json(404, { message });
export const serverError = (message = "Internal server error") =>
  json(500, { message });

/**
 * Extract the Cognito subject (stable unique user id) from the JWT authorizer
 * claims. Throws if the request is somehow unauthenticated.
 */
export function getUserId(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): string {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("Missing authenticated user (sub claim)");
  }
  return sub;
}

/** Best-effort display name / email from the JWT claims. */
export function getUserEmail(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): string | undefined {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  const email = claims?.email;
  return typeof email === "string" ? email : undefined;
}

export function parseBody<T>(body: string | undefined): T {
  if (!body) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    return {} as T;
  }
}
