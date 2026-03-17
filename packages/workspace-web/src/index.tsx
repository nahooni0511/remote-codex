import type { ReactNode } from "react";

import { App } from "./app/App";
import { AppProvider } from "./app/AppProvider";
import "./styles/tokens.css";
import "./styles/global.css";

export { AppProvider, useAppContext } from "./app/AppProvider";
export { App as WorkspaceRoutes } from "./app/App";
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

export function WorkspaceApp({ children }: { children?: ReactNode }) {
  return (
    <AppProvider>
      <App />
      {children}
    </AppProvider>
  );
}
