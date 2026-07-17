import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

/**
 * Orchestrates the passwordless email-code (CUSTOM_AUTH) flow: issue one
 * CUSTOM_CHALLENGE, grant tokens on a correct answer, and fail after 3 wrong
 * tries.
 */
export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session ?? [];

  if (session.length === 0) {
    // First call → present the code challenge.
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = "CUSTOM_CHALLENGE";
  } else {
    const last = session[session.length - 1];
    if (
      last.challengeName === "CUSTOM_CHALLENGE" &&
      last.challengeResult === true
    ) {
      // Correct code → sign them in.
      event.response.issueTokens = true;
      event.response.failAuthentication = false;
    } else if (session.length >= 3) {
      // Too many wrong attempts.
      event.response.issueTokens = false;
      event.response.failAuthentication = true;
    } else {
      // Wrong (or expired) — let them try again with the same code.
      event.response.issueTokens = false;
      event.response.failAuthentication = false;
      event.response.challengeName = "CUSTOM_CHALLENGE";
    }
  }

  return event;
};
