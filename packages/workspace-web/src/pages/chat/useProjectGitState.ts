import type { ProjectGitState, ProjectGitStateResponse, ProjectTreeRecord, ThreadListItem } from "@remote-codex/contracts";
import { useEffect, useState } from "react";

import type { ChatNotice } from "../../features/chat/notice";
import { apiFetch } from "../../lib/api/client";

export function useProjectGitState({
  bootstrapReady,
  project,
  thread,
  onError,
}: {
  bootstrapReady: boolean;
  project: ProjectTreeRecord | null;
  thread: ThreadListItem | null;
  onError: (notice: ChatNotice) => void;
}) {
  const [projectGitStates, setProjectGitStates] = useState<Record<number, ProjectGitState>>({});

  useEffect(() => {
    if (!bootstrapReady || !project || !thread) {
      return;
    }

    let cancelled = false;
    void apiFetch<ProjectGitStateResponse>(`/api/projects/${project.id}/git`)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setProjectGitStates((current) => ({ ...current, [project.id]: payload.git }));
      })
      .catch((error: Error) => {
        if (!cancelled) {
          onError({ tone: "error", message: error.message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapReady, onError, project, thread]);

  const refreshProjectGitState = async (projectId: number) => {
    const payload = await apiFetch<ProjectGitStateResponse>(`/api/projects/${projectId}/git`);
    setProjectGitStates((current) => ({ ...current, [projectId]: payload.git }));
  };

  return {
    gitState: project ? projectGitStates[project.id] || null : null,
    refreshProjectGitState,
  };
}
