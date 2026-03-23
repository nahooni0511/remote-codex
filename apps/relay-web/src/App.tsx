import type { RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { CenteredStatus } from "./components/CenteredStatus";
import { restoreRelaySession, signOutRelaySession } from "./lib/auth";
import { emptyRelaySession } from "./lib/relay-api";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginCallbackPage } from "./pages/LoginCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { RelayServerSettingsPage } from "./pages/RelayServerSettingsPage";
import { WorkspaceShell } from "./pages/WorkspaceShell";

export function App() {
  const [session, setSession] = useState<RelayAuthSession>(emptyRelaySession());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.workspaceViewTransitions = "off";
    return () => {
      delete document.documentElement.dataset.workspaceViewTransitions;
    };
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/login/callback") {
      setLoading(false);
      return;
    }

    void restoreRelaySession()
      .then((result) => setSession(result))
      .catch(() => {
        setSession(emptyRelaySession());
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <CenteredStatus title="Loading relay session" />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} />} />
      <Route
        path="/login/relay-server"
        element={session.user ? <Navigate to="/devices" replace /> : <RelayServerSettingsPage />}
      />
      <Route path="/login/callback" element={<LoginCallbackPage onSession={setSession} />} />
      <Route
        path="/devices"
        element={session.user ? <DevicesPage session={session} onSignOut={signOutRelaySession} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/*"
        element={session.user ? <WorkspaceShell session={session} /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
