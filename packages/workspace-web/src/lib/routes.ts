import type { AppBootstrap } from "@remote-codex/contracts";

let workspaceBasePath = "";

function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

export function configureWorkspaceBasePath(basePath: string): void {
  workspaceBasePath = normalizeBasePath(basePath);
}

export function getWorkspaceBasePath(): string {
  return workspaceBasePath;
}

export function buildWorkspacePath(path: string): string {
  const normalizedPath = path === "/" ? "/" : `/${path.replace(/^\/+/, "")}`;
  if (normalizedPath === "/") {
    return workspaceBasePath || "/";
  }

  return `${workspaceBasePath}${normalizedPath}`;
}

export function getSetupPath(): string {
  return buildWorkspacePath("/setup");
}

export function getIntegrationsPath(): string {
  return buildWorkspacePath("/integrations");
}

export function getChatPath(): string {
  return buildWorkspacePath("/chat");
}

export function getNewProjectPath(): string {
  return buildWorkspacePath("/chat/projects/new");
}

export function getCronJobsPath(): string {
  return buildWorkspacePath("/cron-jobs");
}

export function getConfigPath(): string {
  return buildWorkspacePath("/config");
}

export function buildProjectPath(projectId: number): string {
  return buildWorkspacePath(`/chat/projects/${projectId}`);
}

export function buildThreadPath(projectId: number, threadId: number): string {
  return buildWorkspacePath(`/chat/projects/${projectId}/threads/${threadId}`);
}

export function getFallbackChatPath(bootstrap: AppBootstrap | null | undefined): string {
  if (!bootstrap || !bootstrap.projects.length) {
    return getNewProjectPath();
  }

  return buildProjectPath(bootstrap.projects[0].id);
}
