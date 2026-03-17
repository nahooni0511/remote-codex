import type { AppBootstrap, ProjectTreeRecord, ThreadListItem } from "@remote-codex/contracts";

export function resolveChatSelection(
  bootstrap: AppBootstrap,
  projectIdParam?: string,
  threadIdParam?: string,
): { project: ProjectTreeRecord | null; thread: ThreadListItem | null } {
  const projectId = projectIdParam ? Number(projectIdParam) : null;
  const threadId = threadIdParam ? Number(threadIdParam) : null;

  const project = projectId ? bootstrap.projects.find((entry) => entry.id === projectId) || null : null;
  const thread = project && threadId ? project.threads.find((entry) => entry.id === threadId) || null : null;
  return { project, thread };
}
