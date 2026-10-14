// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SessionUser } from "@clearfea/spec";
import { type FormEvent, useState } from "react";
import { signIn } from "../api/session";

/** Sign-in form for the Phase 0 seeded test users (ADR-022). */
export function SignIn({
  onSignedIn,
  notice,
}: {
  onSignedIn: (user: SessionUser) => void;
  notice?: string;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | undefined>(notice);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await signIn(login.trim(), password);
    setBusy(false);
    if (result.kind === "ok") onSignedIn(result.value);
    else setProblem(result.problem);
  }

  return (
    <main className="signin" aria-label="Sign in">
      <form className="signin-form" onSubmit={submit}>
        <h1 className="signin-title">ClearFEA</h1>
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
        {problem && (
          <p className="form-problem" role="alert">
            {problem}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="signin-hint">
          Local test users are listed in <code>apps/api/seed/test-users.sql</code>.
        </p>
      </form>
    </main>
  );
}
