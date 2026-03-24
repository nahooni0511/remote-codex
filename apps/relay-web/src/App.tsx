import type { RelayAuthSession } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { CenteredStatus } from "./components/CenteredStatus";
import { restoreRelaySession, signOutRelaySession } from "./lib/auth";
import {
  buildLegacyStudioRedirectTarget,
  isLegacyStudioPath,
  isStudioCallbackPath,
  isStudioPath,
  PRICING_PATH,
  STUDIO_BASE_PATH,
  STUDIO_DEVICES_PATH,
  STUDIO_LOGIN_CALLBACK_PATH,
  STUDIO_LOGIN_PATH,
  STUDIO_RELAY_SERVER_SETTINGS_PATH,
} from "./lib/routes";
import { emptyRelaySession } from "./lib/relay-api";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginCallbackPage } from "./pages/LoginCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { MarketingPage } from "./pages/MarketingPage";
import { PricingPage } from "./pages/PricingPage";
import { RelayServerSettingsPage } from "./pages/RelayServerSettingsPage";
import { WorkspaceShell } from "./pages/WorkspaceShell";

function LegacyStudioRedirect() {
  const location = useLocation();
  return <Navigate to={buildLegacyStudioRedirectTarget(location.pathname, location.search, location.hash)} replace />;
}

export function App() {
  const [session, setSession] = useState<RelayAuthSession>(emptyRelaySession());
  const [loading, setLoading] = useState(true);
  const pathname = window.location.pathname;

  useEffect(() => {
    document.documentElement.dataset.workspaceViewTransitions = "off";
    return () => {
      delete document.documentElement.dataset.workspaceViewTransitions;
    };
  }, []);

  useEffect(() => {
    if (isStudioCallbackPath(window.location.pathname)) {
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

  if (loading && !isStudioCallbackPath(pathname) && (isStudioPath(pathname) || isLegacyStudioPath(pathname))) {
    return <CenteredStatus title="Loading relay session" />;
  }

  return (
    <Routes>
      <Route path="/" element={<MarketingPage session={session} />} />
      <Route path={PRICING_PATH} element={<PricingPage session={session} />} />
      <Route path="/login/*" element={<LegacyStudioRedirect />} />
      <Route path="/devices" element={<LegacyStudioRedirect />} />
      <Route path="/setup" element={<LegacyStudioRedirect />} />
      <Route path="/integrations" element={<LegacyStudioRedirect />} />
      <Route path="/chat/*" element={<LegacyStudioRedirect />} />
      <Route path="/cron-jobs" element={<LegacyStudioRedirect />} />
      <Route path="/config" element={<LegacyStudioRedirect />} />
      <Route path={STUDIO_LOGIN_PATH} element={<LoginPage session={session} />} />
      <Route
        path={STUDIO_RELAY_SERVER_SETTINGS_PATH}
        element={session.user ? <Navigate to={STUDIO_DEVICES_PATH} replace /> : <RelayServerSettingsPage />}
      />
      <Route path={STUDIO_LOGIN_CALLBACK_PATH} element={<LoginCallbackPage onSession={setSession} />} />
      <Route
        path={STUDIO_DEVICES_PATH}
        element={
          session.user ? <DevicesPage session={session} onSignOut={signOutRelaySession} /> : <Navigate to={STUDIO_LOGIN_PATH} replace />
        }
      />
      <Route
        path={`${STUDIO_BASE_PATH}/*`}
        element={session.user ? <WorkspaceShell session={session} /> : <Navigate to={STUDIO_LOGIN_PATH} replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
