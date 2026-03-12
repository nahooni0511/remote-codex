import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { EmptyState } from "../components/ui/EmptyState";
import { useAppContext } from "./AppProvider";
import { getFallbackChatPath } from "../lib/routes";
import { ChatPage } from "../pages/ChatPage";
import { ConfigPage } from "../pages/ConfigPage";
import { CronPage } from "../pages/CronPage";
import { SetupPage } from "../pages/SetupPage";

function HomeRoute() {
  const { bootstrap, loading } = useAppContext();

  if (loading) {
    return <EmptyState title="Loading workspace" description="Bootstrap state is loading from the API server." />;
  }

  return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
}

function SetupGuard() {
  const { bootstrap, loading } = useAppContext();
  const location = useLocation();

  if (loading) {
    return <EmptyState title="Loading workspace" description="Waiting for setup state." />;
  }

  if (bootstrap?.setupComplete && location.pathname === "/setup") {
    return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
  }

  return <SetupPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/setup" element={<SetupGuard />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/projects/new" element={<ChatPage />} />
      <Route path="/chat/projects/:projectId" element={<ChatPage />} />
      <Route path="/chat/projects/:projectId/threads/:threadId" element={<ChatPage />} />
      <Route path="/cron-jobs" element={<CronPage />} />
      <Route path="/config" element={<ConfigPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
