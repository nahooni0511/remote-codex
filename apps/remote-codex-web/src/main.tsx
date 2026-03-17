import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { WorkspaceApp, configureWorkspaceTransport, createDirectWorkspaceTransport } from "@remote-codex/workspace-web";

configureWorkspaceTransport(createDirectWorkspaceTransport());

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <WorkspaceApp />
  </BrowserRouter>,
);
