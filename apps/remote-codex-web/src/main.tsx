import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  WorkspaceApp,
  configureWorkspaceBasePath,
  configureWorkspaceTransport,
  createDirectWorkspaceTransport,
} from "@remote-codex/workspace-web";

configureWorkspaceBasePath("");
configureWorkspaceTransport(createDirectWorkspaceTransport());

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <WorkspaceApp />
  </BrowserRouter>,
);
