import type { PreSignUpTriggerHandler } from "aws-lambda";

/**
 * Auto-confirms passwordless sign-ups so a first-time user can sign in with an
 * emailed code right away. Regular password sign-ups (no `passwordless` flag)
 * still go through the normal email-verification step untouched.
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  if (event.request.validationData?.passwordless === "true") {
    event.response.autoConfirmUser = true;
    if (event.request.userAttributes.email) {
      event.response.autoVerifyEmail = true;
    }
  }
  return event;
};
