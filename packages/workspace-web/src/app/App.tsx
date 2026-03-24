import { Navigate, Route, Routes } from "react-router-dom";

import { EmptyState } from "../components/ui/EmptyState";
import { useAppContext } from "./AppProvider";
import {
  buildWorkspacePath,
  getConfigPath,
  getCronJobsPath,
  getFallbackChatPath,
  getIntegrationsPath,
  getSetupPath,
} from "../lib/routes";
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

export function App() {
  return (
    <Routes>
      <Route path={buildWorkspacePath("/")} element={<HomeRoute />} />
      <Route path={getSetupPath()} element={<SetupPage />} />
      <Route path={getIntegrationsPath()} element={<SetupPage />} />
      <Route path={buildWorkspacePath("/chat")} element={<ChatPage />} />
      <Route path={buildWorkspacePath("/chat/projects/new")} element={<ChatPage />} />
      <Route path={buildWorkspacePath("/chat/projects/:projectId")} element={<ChatPage />} />
      <Route path={buildWorkspacePath("/chat/projects/:projectId/threads/:threadId")} element={<ChatPage />} />
      <Route path={getCronJobsPath()} element={<CronPage />} />
      <Route path={getConfigPath()} element={<ConfigPage />} />
      <Route path="*" element={<Navigate to={buildWorkspacePath("/")} replace />} />
    </Routes>
  );
}
