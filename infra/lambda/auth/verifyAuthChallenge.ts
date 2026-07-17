import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";

/** Compares the submitted code with the private challenge parameter. */
export const handler: VerifyAuthChallengeResponseTriggerHandler = async (
  event
) => {
  const expected = event.request.privateChallengeParameters?.code;
  const provided = (event.request.challengeAnswer ?? "").trim();
  event.response.answerCorrect = Boolean(expected) && provided === expected;
  return event;
};
