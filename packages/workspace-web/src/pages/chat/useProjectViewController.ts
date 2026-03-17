import type { AppBootstrap, ProjectTreeRecord, ThreadListItem } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ChatNotice } from "../../features/chat/notice";
import { apiFetch } from "../../lib/api/client";
import { navigateWithTransition } from "../../lib/navigation";
import { buildProjectPath, buildThreadPath, getFallbackChatPath } from "../../lib/routes";

type ProjectDraft = {
  name: string;
  folderPath: string;
};

export function useProjectViewController({
  bootstrap,
  project,
  thread,
  projectIdParam,
  isNewProjectRoute,
  refreshBootstrap,
}: {
  bootstrap: AppBootstrap | null;
  project: ProjectTreeRecord | null;
  thread: ThreadListItem | null;
  projectIdParam?: string;
  isNewProjectRoute: boolean;
  refreshBootstrap: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<number, boolean>>({});
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>({ name: "", folderPath: "" });
  const [projectNotice, setProjectNotice] = useState<ChatNotice>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setExpandedProjectIds((current) => {
      const next = { ...current };
      bootstrap.projects.forEach((entry) => {
        if (next[entry.id] === undefined) {
          next[entry.id] = entry.id === Number(projectIdParam || 0);
        }
      });

      const selectedProjectId = Number(projectIdParam || 0);
      if (selectedProjectId) {
        next[selectedProjectId] = true;
      }
      return next;
    });
  }, [bootstrap, projectIdParam]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    if (isNewProjectRoute) {
      setProjectDraft({ name: "", folderPath: "" });
      return;
    }

    if (project && !thread) {
      setProjectDraft({ name: project.name, folderPath: project.folderPath });
    }
  }, [bootstrap, isNewProjectRoute, project, thread]);

  const createThreadInProject = (projectId: number, onError: (error: Error) => void) => {
    const title = window.prompt("새 thread 제목을 입력하세요.");
    if (!title?.trim()) {
      return;
    }

    void apiFetch<ThreadListItem>(`/api/projects/${projectId}/threads`, {
      method: "POST",
      body: JSON.stringify({ title: title.trim() }),
    })
      .then(async (createdThread) => {
        await refreshBootstrap();
        navigateWithTransition(navigate, buildThreadPath(projectId, createdThread.id));
      })
      .catch(onError);
  };

  const saveProject = () => {
    if (!bootstrap) {
      return;
    }

    setProjectNotice(null);
    const payload = isNewProjectRoute
      ? { name: projectDraft.name, folderPath: projectDraft.folderPath }
      : { folderPath: projectDraft.folderPath };

    void apiFetch<ProjectTreeRecord | { id: number }>(isNewProjectRoute ? "/api/projects" : `/api/projects/${project?.id}`, {
      method: isNewProjectRoute ? "POST" : "PUT",
      body: JSON.stringify(payload),
    })
      .then(async (savedProject) => {
        await refreshBootstrap();
        const nextProjectId = "id" in savedProject ? savedProject.id : project?.id;
        if (!nextProjectId) {
          return;
        }

        setProjectNotice({
          tone: "success",
          message: isNewProjectRoute ? "project를 생성했습니다." : "project를 저장했습니다.",
        });
        navigateWithTransition(navigate, buildProjectPath(nextProjectId), { replace: true });
      })
      .catch((error: Error) => {
        setProjectNotice({ tone: "error", message: error.message });
      });
  };

  const deleteProject = () => {
    if (!bootstrap || !project) {
      return;
    }

    const confirmed = window.confirm(
      `정말 "${project.name}" project를 삭제할까요?\n로컬 DB의 project, thread, message 기록이 삭제됩니다.`,
    );
    if (!confirmed) {
      return;
    }

    void apiFetch<void>(`/api/projects/${project.id}`, { method: "DELETE" })
      .then(async () => {
        await refreshBootstrap();
        navigateWithTransition(navigate, getFallbackChatPath(bootstrap), { replace: true });
      })
      .catch((error: Error) => {
        setProjectNotice({ tone: "error", message: error.message });
      });
  };

  const cancelProjectEdit = () => {
    if (!bootstrap) {
      return;
    }

    navigateWithTransition(navigate, getFallbackChatPath(bootstrap), { replace: true });
  };

  return {
    expandedProjectIds,
    folderBrowserOpen,
    projectDraft,
    projectNotice,
    setExpandedProjectIds,
    setFolderBrowserOpen,
    setProjectDraft,
    setProjectNotice,
    cancelProjectEdit,
    createThreadInProject,
    deleteProject,
    saveProject,
  };
}
