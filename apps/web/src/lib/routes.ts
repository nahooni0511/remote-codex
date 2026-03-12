import type { AppBootstrap } from "@remote-codex/contracts";

export function buildProjectPath(projectId: number): string {
  return `/chat/projects/${projectId}`;
}

export function buildThreadPath(projectId: number, threadId: number): string {
  return `/chat/projects/${projectId}/threads/${threadId}`;
}

export function getFallbackChatPath(bootstrap: AppBootstrap | null | undefined): string {
  if (!bootstrap?.setupComplete) {
    return "/setup";
  }

  if (!bootstrap.projects.length) {
    return "/chat/projects/new";
  }

  return buildProjectPath(bootstrap.projects[0].id);
}
