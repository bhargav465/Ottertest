import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { config } from "./config";

const pool = new CognitoUserPool({
  UserPoolId: config.userPoolId,
  ClientId: config.userPoolClientId,
});

export interface AuthUser {
  email: string;
  idToken: string;
}

export function signUp(
  email: string,
  password: string,
  fullName?: string
): Promise<void> {
  const attrs = [
    new CognitoUserAttribute({ Name: "email", Value: email }),
    ...(fullName
      ? [new CognitoUserAttribute({ Name: "name", Value: fullName })]
      : []),
  ];
  return new Promise((resolve, reject) => {
    pool.signUp(email, password, attrs, [], (err) =>
      err ? reject(err) : resolve()
    );
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

export function resendCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

export function signIn(email: string, password: string): Promise<CognitoUserSession> {
  const user = new CognitoUser({ Username: email, Pool: pool });
  const details = new AuthenticationDetails({
    Username: email,
    Password: password,
  });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  pool.getCurrentUser()?.signOut();
}

/**
 * A code-based (passwordless) sign-in in progress. Hold onto the returned
 * `user` and pass it, plus the emailed code, to `answerEmailCode`.
 */
export interface EmailCodeChallenge {
  user: CognitoUser;
}

/** Generates a random password that satisfies the Cognito password policy. */
function randomPassword(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (n) => n.toString(36)).join("");
  // Guarantee an uppercase letter, a digit, and a symbol.
  return `Aa1!${body}`;
}

/**
 * Ensures an account exists for `email` so the passwordless code flow can run.
 * New accounts are created with a throwaway password and a `passwordless` flag
 * that the PreSignUp trigger uses to auto-confirm them (no separate email
 * verification step). An already-registered email is left untouched.
 */
function ensureAccount(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const attrs = [new CognitoUserAttribute({ Name: "email", Value: email })];
    // validationData reaches the PreSignUp Lambda, which auto-confirms the user.
    const validation = [
      new CognitoUserAttribute({ Name: "passwordless", Value: "true" }),
    ];
    pool.signUp(email, randomPassword(), attrs, validation, (err) => {
      if (!err || err.name === "UsernameExistsException") resolve();
      else reject(err);
    });
  });
}

/**
 * Begins the passwordless email-code (CUSTOM_AUTH) flow: makes sure the account
 * exists, then has Cognito email a 6-digit code and resolves once the challenge
 * is presented. Finish with `answerEmailCode`.
 */
export function startEmailCodeSignIn(
  email: string
): Promise<EmailCodeChallenge> {
  return ensureAccount(email).then(
    () =>
      new Promise((resolve, reject) => {
        const user = new CognitoUser({ Username: email, Pool: pool });
        const details = new AuthenticationDetails({ Username: email });
        // `initiateAuth` runs a pure CUSTOM_AUTH flow. (`authenticateUser` would
        // force the SRP handshake, whose Buffer/WordArray crypto throws here and
        // which mishandles the CUSTOM_CHALLENGE response.)
        user.initiateAuth(details, {
          // The custom challenge is presented → the code has been emailed.
          customChallenge: () => resolve({ user }),
          onSuccess: () => resolve({ user }),
          onFailure: (err) => reject(err),
        });
      })
  );
}

/**
 * Answers a passwordless email-code challenge. Resolves with the session on the
 * correct code; rejects (and the caller can retry) on a wrong one.
 */
export function answerEmailCode(
  challenge: EmailCodeChallenge,
  code: string
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    challenge.user.sendCustomChallengeAnswer(code.trim(), {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

/** Permanently delete the currently signed-in Cognito account. */
export function deleteCurrentUser(): Promise<void> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.reject(new Error("Not signed in"));
  return new Promise((resolve, reject) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        reject(err || new Error("No valid session"));
        return;
      }
      user.deleteUser((delErr) => (delErr ? reject(delErr) : resolve()));
    });
  });
}

/** Resolve the current signed-in user with a fresh (auto-refreshed) id token. */
export function getCurrentUser(): Promise<AuthUser | null> {
  const user = pool.getCurrentUser();
  if (!user) return Promise.resolve(null);
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      const idToken = session.getIdToken();
      resolve({
        email: idToken.payload.email ?? user.getUsername(),
        idToken: idToken.getJwtToken(),
      });
    });
  });
}
