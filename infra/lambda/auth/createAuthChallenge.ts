import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({});
const FROM = process.env.SES_FROM_EMAIL || "";

/**
 * Generates a 6-digit code, emails it to the user (via SES), and stashes it as
 * a private challenge parameter for verifyAuthChallenge to compare against.
 * The code is reused across retries within the same auth session.
 */
export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  let code: string;

  const session = event.request.session ?? [];
  const prior = session.length
    ? session[session.length - 1].challengeMetadata
    : undefined;

  if (prior && prior.startsWith("CODE-")) {
    code = prior.slice(5); // reuse the code on a retry
  } else {
    code = String(Math.floor(100000 + Math.random() * 900000));
    const email = event.request.userAttributes.email;
    if (FROM && email) {
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: `Your Ottertest sign-in code: ${code}` },
              Body: {
                Text: {
                  Data: `Your Ottertest sign-in code is ${code}\n\nIt expires in a few minutes. If you didn't request this, you can ignore this email.`,
                },
                Html: {
                  Data: `<div style="font-family:sans-serif"><p>Your Ottertest sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:3px">${code}</p><p style="color:#666">It expires in a few minutes. If you didn't request this, you can ignore this email.</p></div>`,
                },
              },
            },
          },
        })
      );
    } else {
      console.error(
        "SES_FROM_EMAIL is not configured (or user has no email) — cannot send the sign-in code."
      );
    }
  }

  // `email` is public (shown to the client); `code` stays private (server-side).
  event.response.publicChallengeParameters = {
    email: event.request.userAttributes.email ?? "",
  };
  event.response.privateChallengeParameters = { code };
  event.response.challengeMetadata = `CODE-${code}`;

  return event;
};
