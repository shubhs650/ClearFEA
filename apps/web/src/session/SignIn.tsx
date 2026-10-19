// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SessionUser } from "@clearfea/spec";
import { type FormEvent, useEffect, useState } from "react";
import { fetchSignInOptions, googleErrorMessage, signIn, startGoogleSignIn } from "../api/session";
import { Logo } from "../layout/AppHeader";

type Mode = "checking" | "password" | "google";

/**
 * The refused or failed Google sign-in Google's callback reported in the address (`?error=`),
 * taken out of the address so a reload does not show it again.
 */
function takeGoogleError(): string | undefined {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("error");
  if (code === null) return undefined;
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return googleErrorMessage(code);
}

/**
 * The sign-in screen. On the live site (M10.3, ADR-097) it is one "Sign in with Google" button
 * for invited addresses; locally it is the form for the seeded test users (ADR-022).
 */
export function SignIn({
  onSignedIn,
  notice,
}: {
  onSignedIn: (user: SessionUser) => void;
  notice?: string;
}) {
  const [mode, setMode] = useState<Mode>("checking");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | undefined>(() => takeGoogleError() ?? notice);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    fetchSignInOptions().then((result) => {
      if (!current) return;
      if (result.kind === "ok") setMode(result.value.signIn);
      else {
        setMode("password");
        setProblem((was) => was ?? result.problem);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await signIn(login.trim(), password);
    setBusy(false);
    if (result.kind === "ok") onSignedIn(result.value);
    else setProblem(result.problem);
  }

  async function google() {
    setBusy(true);
    setProblem(undefined);
    const result = await startGoogleSignIn();
    // On success the browser is already leaving for Google.
    if (result.kind !== "ok") {
      setBusy(false);
      setProblem(result.problem);
    }
  }

  const heading = (
    <>
      <h1 className="signin-title">
        <Logo size={32} />
        ClearFEA
      </h1>
      <p className="signin-tagline">Open finite element analysis on CalculiX</p>
    </>
  );
  const shownProblem = problem && (
    <p className="form-problem" role="alert">
      {problem}
    </p>
  );

  if (mode === "google") {
    return (
      <main className="signin" aria-label="Sign in">
        <div className="signin-form">
          {heading}
          <p className="signin-beta">
            ClearFEA is in a closed beta. Sign in with the Google account you were invited with.
          </p>
          {shownProblem}
          <button type="button" className="google-button" onClick={google} disabled={busy}>
            <GoogleMark />
            {busy ? "Opening Google…" : "Sign in with Google"}
          </button>
          <p className="signin-hint">
            ClearFEA reads only your name and email address from Google, to know who you are.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="signin" aria-label="Sign in">
      <form className="signin-form" onSubmit={submit}>
        {heading}
        <label className="field">
          <span>Login</span>
          <input
            name="login"
            autoComplete="username"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {shownProblem}
        <button type="submit" disabled={busy || mode === "checking"}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="signin-hint">
          Local test users are listed in <code>apps/api/seed/test-users.sql</code>.
        </p>
      </form>
    </main>
  );
}

/** Google's "G", as Google's sign-in branding guidelines ask buttons to show it. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
