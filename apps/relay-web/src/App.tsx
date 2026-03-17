import type { RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CenteredStatus } from "./components/CenteredStatus";
import { clearStoredAuth, getIdToken, signOutHostedUi } from "./lib/auth";
import { emptyRelaySession, fetchRelayJson } from "./lib/relay-api";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginCallbackPage } from "./pages/LoginCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { WorkspaceShell } from "./pages/WorkspaceShell";

export function App() {
  const [session, setSession] = useState<RelayAuthSession>(emptyRelaySession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getIdToken()) {
      setSession(emptyRelaySession());
      setLoading(false);
      return;
    }

    void fetchRelayJson<RelayAuthSession>("/api/session")
      .then((result) => setSession(result))
      .catch(() => {
        clearStoredAuth();
        setSession(emptyRelaySession());
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <CenteredStatus title="Loading relay session" />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} onSignOut={signOutHostedUi} />} />
      <Route path="/login/callback" element={<LoginCallbackPage onSession={setSession} />} />
      <Route
        path="/devices"
        element={session.user ? <DevicesPage session={session} onSignOut={signOutHostedUi} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/*"
        element={session.user ? <WorkspaceShell session={session} /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
