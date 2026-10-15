// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SessionUser } from "@clearfea/spec";
import { useCallback, useEffect, useState } from "react";
import { fetchSession, signOut } from "./api/session";
import { GeometryPanel } from "./geometry/GeometryPanel";
import { TestJobs } from "./jobs/TestJobs";
import { SettingsPanel } from "./layout/SettingsPanel";
import { SimulationTree } from "./layout/SimulationTree";
import { StatusBar } from "./layout/StatusBar";
import { Viewer } from "./layout/Viewer";
import { SignIn } from "./session/SignIn";

type SessionState =
  | { kind: "checking" }
  | { kind: "signedOut"; notice?: string }
  | { kind: "signedIn"; user: SessionUser };

/**
 * Sign-in form until a user is signed in, then the layout shell: tree on the left,
 * viewer in the centre, settings on the right, status bar along the bottom.
 */
export function App() {
  const [session, setSession] = useState<SessionState>({ kind: "checking" });

  useEffect(() => {
    let current = true;
    fetchSession().then((result) => {
      if (!current) return;
      if (result.kind === "ok") setSession({ kind: "signedIn", user: result.value });
      else if (result.kind === "signedOut") setSession({ kind: "signedOut" });
      else setSession({ kind: "signedOut", notice: result.problem });
    });
    return () => {
      current = false;
    };
  }, []);

  const signedOut = useCallback((notice?: string) => setSession({ kind: "signedOut", notice }), []);

  async function leave() {
    await signOut();
    signedOut();
  }

  if (session.kind !== "signedIn") {
    return (
      <div className="signin-page">
        {session.kind === "signedOut" && (
          <SignIn
            notice={session.notice}
            onSignedIn={(user) => setSession({ kind: "signedIn", user })}
          />
        )}
        <StatusBar />
      </div>
    );
  }

  return (
    <div className="shell">
      <SimulationTree />
      <Viewer />
      <SettingsPanel>
        <GeometryPanel onSignedOut={signedOut} />
        <TestJobs onSignedOut={signedOut} />
      </SettingsPanel>
      <StatusBar user={session.user} onSignOut={leave} />
    </div>
  );
}
