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
