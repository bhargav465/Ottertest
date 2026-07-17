# Passwordless email-code sign-in

Ottertest supports two ways to sign in:

1. **Email + password** — the classic flow. Always works, no setup needed.
2. **Email me a one-time code** — passwordless. Cognito emails a 6-digit code
   and the user types it in. No password to remember.

The passwordless path is powered by a Cognito **CUSTOM_AUTH** flow with three
Lambda triggers (`infra/lambda/auth/`) plus a PreSignUp trigger that
auto-confirms first-time passwordless users. The code email itself is sent via
**Amazon SES**.

## One-time setup (required for codes to send)

The code emails go out through SES from a sender address **you** verify. Until
that's done, the passwordless button will show an error — but password login
keeps working, so the app is never blocked.

### 1. Verify a sender identity in SES

In the AWS console (same region as the stack, e.g. `us-east-1`):

- **SES → Identities → Create identity**
- Verify either a single email address (quickest) or a whole domain
  (recommended for production — lets you send as `no-reply@yourdomain`).
- Click the verification link SES emails you (for a single-address identity),
  or add the DKIM records (for a domain identity).

### 2. Add the `SES_FROM_EMAIL` GitHub secret

- GitHub repo → **Settings → Secrets and variables → Actions → New repository
  secret**
- Name: `SES_FROM_EMAIL`
- Value: the address you just verified, e.g. `no-reply@yourdomain.com`

The deploy workflow passes this to the `CreateAuthChallengeFn` Lambda. Re-run
**Deploy to AWS** after adding it.

### 3. (Production) Leave the SES sandbox

New SES accounts start in the **sandbox**, which can only send to
**verified** recipient addresses. That's fine for testing with your own email,
but real users won't receive codes until you request production access:

- **SES → Account dashboard → Request production access**

Approval is usually quick. Until then, verify each test recipient under **SES →
Identities** too.

## How it works

- `startEmailCodeSignIn(email)` (frontend) makes sure the account exists
  (creating it with a throwaway password + a `passwordless` flag if it's new),
  then starts `CUSTOM_AUTH`.
- `preSignUp.ts` auto-confirms accounts created with that flag, so a brand-new
  user can sign in with a code on their very first try.
- `createAuthChallenge.ts` generates a 6-digit code, emails it via SES, and
  stores it as a private challenge parameter (never sent to the browser).
- `verifyAuthChallenge.ts` compares the typed code to the stored one.
- `defineAuthChallenge.ts` orchestrates: one code challenge, tokens on success,
  fail after 3 wrong tries.

Nothing here changes the email+password flow — it's purely additive.
