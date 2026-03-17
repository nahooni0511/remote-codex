import type { AppBootstrap } from "@remote-codex/contracts";

type WorkspaceIdentity = Pick<AppBootstrap, "device" | "integrations">;

export function getWorkspaceUserName(bootstrap: WorkspaceIdentity) {
  return bootstrap.integrations.telegram.userName || bootstrap.device.displayName || "User";
}
