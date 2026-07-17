import { useState } from "react";
import {
  signIn,
  signUp,
  confirmSignUp,
  resendCode,
  getCurrentUser,
  startEmailCodeSignIn,
  answerEmailCode,
  type AuthUser,
  type EmailCodeChallenge,
} from "../lib/auth";

type Mode = "signin" | "signup" | "confirm" | "emailcode" | "emailverify";

export function AuthPanel({
  onAuthenticated,
}: {
  onAuthenticated: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<EmailCodeChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = () =>
    run(async () => {
      await signIn(email, password);
      const user = await getCurrentUser();
      if (user) onAuthenticated(user);
      else throw new Error("Could not establish a session");
    });

  const handleSignUp = () =>
    run(async () => {
      await signUp(email, password, fullName);
      setInfo(`We emailed a 6-digit code to ${email}.`);
      setMode("confirm");
    });

  const handleConfirm = () =>
    run(async () => {
      await confirmSignUp(email, code);
      await signIn(email, password);
      const user = await getCurrentUser();
      if (user) onAuthenticated(user);
      else {
        setInfo("Account confirmed — please sign in.");
        setMode("signin");
      }
    });

  const handleEmailCodeStart = () =>
    run(async () => {
      const ch = await startEmailCodeSignIn(email);
      setChallenge(ch);
      setCode("");
      setInfo(`We emailed a 6-digit sign-in code to ${email}.`);
      setMode("emailverify");
    });

  const handleEmailCodeVerify = () =>
    run(async () => {
      if (!challenge) throw new Error("Start over and request a new code.");
      await answerEmailCode(challenge, code);
      const user = await getCurrentUser();
      if (user) onAuthenticated(user);
      else throw new Error("That code didn't work — request a new one.");
    });

  const heading =
    mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create your account"
        : mode === "emailcode"
          ? "Sign in with a code"
          : "Check your email";

  const subheading =
    mode === "confirm" || mode === "emailverify"
      ? `Enter the 6-digit code we sent to ${email || "your email"}.`
      : mode === "emailcode"
        ? "No password needed — we'll email you a one-time code to sign in."
        : "Record, transcribe and summarize your meetings — privately, in your own account.";

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand big">
          <span className="logo">🦦</span>
          <span>Ottertest</span>
        </div>

        <h1 className="auth-heading">{heading}</h1>
        <p className="muted auth-sub">{subheading}</p>

        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert info">{info}</div>}

        {mode === "confirm" || mode === "emailverify" ? (
          <>
            <label className="field">
              <span>6-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  code &&
                  (mode === "emailverify"
                    ? handleEmailCodeVerify()
                    : handleConfirm())
                }
              />
            </label>
            <button
              className="btn primary block lg"
              disabled={busy || !code}
              onClick={
                mode === "emailverify" ? handleEmailCodeVerify : handleConfirm
              }
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <div className="auth-links">
              <button
                className="btn link"
                onClick={() =>
                  run(() =>
                    mode === "emailverify"
                      ? handleEmailCodeStart()
                      : resendCode(email).then(() => setInfo("New code sent."))
                  )
                }
              >
                Resend code
              </button>
              <button
                className="btn link"
                onClick={() => {
                  setChallenge(null);
                  setMode("signin");
                }}
              >
                Back to sign in
              </button>
            </div>
          </>
        ) : mode === "emailcode" ? (
          <>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                onKeyDown={(e) =>
                  e.key === "Enter" && email && handleEmailCodeStart()
                }
              />
            </label>
            <button
              className="btn primary block lg"
              disabled={busy || !email}
              onClick={handleEmailCodeStart}
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
            <p className="switch muted">
              Prefer a password?{" "}
              <button className="btn link" onClick={() => setMode("signin")}>
                Sign in with password
              </button>
            </p>
          </>
        ) : (
          <>
            {mode === "signup" && (
              <label className="field">
                <span>Your name</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (mode === "signin" ? handleSignIn() : handleSignUp())
                }
              />
            </label>

            <button
              className="btn primary block lg"
              disabled={busy || !email || !password}
              onClick={mode === "signin" ? handleSignIn : handleSignUp}
            >
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>

            {mode === "signin" && (
              <>
                <div className="auth-divider">
                  <span>or</span>
                </div>
                <button
                  className="btn block"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setInfo(null);
                    setMode("emailcode");
                  }}
                >
                  Email me a one-time code
                </button>
              </>
            )}

            <p className="switch muted">
              {mode === "signin" ? (
                <>
                  New to Ottertest?{" "}
                  <button className="btn link" onClick={() => setMode("signup")}>
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button className="btn link" onClick={() => setMode("signin")}>
                    Sign in
                  </button>
                </>
              )}
            </p>
          </>
        )}

        <p className="auth-legal muted small">
          <a className="privacy-link" href="/privacy.html" target="_blank" rel="noopener">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
