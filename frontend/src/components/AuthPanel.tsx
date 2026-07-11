import { useState } from "react";
import {
  signIn,
  signUp,
  confirmSignUp,
  resendCode,
  getCurrentUser,
  type AuthUser,
} from "../lib/auth";

type Mode = "signin" | "signup" | "confirm";

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
      setInfo("We emailed you a verification code.");
      setMode("confirm");
    });

  const handleConfirm = () =>
    run(async () => {
      await confirmSignUp(email, code);
      await signIn(email, password);
      const user = await getCurrentUser();
      if (user) onAuthenticated(user);
      else {
        setInfo("Account confirmed. Please sign in.");
        setMode("signin");
      }
    });

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand big">
          <span className="logo">🦦</span>
          <span>Ottertest</span>
        </div>
        <p className="muted tagline">
          Record, transcribe and summarize your meetings — in your own AWS
          account.
        </p>

        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert info">{info}</div>}

        {mode === "confirm" ? (
          <>
            <label className="field">
              <span>Verification code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
              />
            </label>
            <button
              className="btn primary block"
              disabled={busy}
              onClick={handleConfirm}
            >
              {busy ? "Confirming…" : "Confirm & sign in"}
            </button>
            <button
              className="btn link"
              onClick={() => run(() => resendCode(email).then(() => setInfo("Code resent.")))}
            >
              Resend code
            </button>
          </>
        ) : (
          <>
            {mode === "signup" && (
              <label className="field">
                <span>Full name</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ada Lovelace"
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
                autoFocus
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  (mode === "signin" ? handleSignIn() : handleSignUp())
                }
              />
            </label>

            <button
              className="btn primary block"
              disabled={busy}
              onClick={mode === "signin" ? handleSignIn : handleSignUp}
            >
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </>
        )}

        {mode !== "confirm" && (
          <p className="switch muted">
            {mode === "signin" ? (
              <>
                No account?{" "}
                <button className="btn link" onClick={() => setMode("signup")}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have one?{" "}
                <button className="btn link" onClick={() => setMode("signin")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
        <p className="switch muted small">
          <a className="privacy-link" href="/privacy.html" target="_blank" rel="noopener">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
