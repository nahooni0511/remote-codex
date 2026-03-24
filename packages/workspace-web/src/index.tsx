import type { ReactNode } from "react";

import { App } from "./app/App";
import { AppProvider } from "./app/AppProvider";
import { WorkspaceChromeProvider } from "./app/WorkspaceChrome";
import "./styles/tokens.css";
import "./styles/global.css";

export { AppProvider, useAppContext } from "./app/AppProvider";
export { App as WorkspaceRoutes } from "./app/App";
export { Icon } from "./components/ui/Icon";
export {
  ApiError,
  apiFetch,
  configureWorkspaceTransport,
  connectRealtime,
  createDirectWorkspaceTransport,
  createRelayWorkspaceTransport,
  fetchAttachmentBlob,
  resetWorkspaceTransport,
  type WorkspaceTransport,
} from "./lib/api/client";
export { navigateWithTransition } from "./lib/navigation";
export { configureWorkspaceBasePath } from "./lib/routes";

export function WorkspaceApp({
  children,
  railSlot,
}: {
  children?: ReactNode;
  railSlot?: ReactNode;
}) {
  return (
    <AppProvider>
      <WorkspaceChromeProvider railSlot={railSlot}>
        <App />
        {children}
      </WorkspaceChromeProvider>
    </AppProvider>
  );
}
