import type { AppBootstrap, ProjectTreeRecord, ThreadListItem } from "@remote-codex/contracts";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { Banner } from "../components/ui/Banner";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Icon } from "../components/ui/Icon";
import { apiFetch } from "../lib/api/client";
import { buildProjectPath, buildThreadPath, getFallbackChatPath } from "../lib/routes";
import { ChatSidebar } from "../features/chat/ChatSidebar";
import { ProjectPanel } from "../features/chat/ProjectPanel";
import { ThreadPanel } from "../features/chat/ThreadPanel";
import styles from "./ChatPage.module.css";

type Notice = { tone: "error" | "success"; message: string } | null;

function resolveSelection(
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

export function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const {
    bootstrap,
    loading,
    loadError,
    flash,
    setFlash,
    refreshBootstrap,
    loadThreadMessages,
    threadCache,
    threadRuntimeStates,
    liveStreams,
  } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<number, boolean>>({});
  const [projectDraft, setProjectDraft] = useState({ name: "", folderPath: "" });
  const [projectNotice, setProjectNotice] = useState<Notice>(null);
  const [threadNotice, setThreadNotice] = useState<Notice>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<number, string>>({});
  const [submittingThreadId, setSubmittingThreadId] = useState<number | null>(null);
  const [loadingOlderThreadId, setLoadingOlderThreadId] = useState<number | null>(null);

  const isNewProjectRoute = location.pathname === "/chat/projects/new";

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    setExpandedProjectIds((current) => {
      const next = { ...current };
      bootstrap.projects.forEach((project) => {
        if (next[project.id] === undefined) {
          next[project.id] = project.id === Number(params.projectId || 0);
        }
      });
      const selectedProjectId = Number(params.projectId || 0);
      if (selectedProjectId) {
        next[selectedProjectId] = true;
      }
      return next;
    });
  }, [bootstrap, params.projectId]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const { project, thread } = resolveSelection(bootstrap, params.projectId, params.threadId);
    if (isNewProjectRoute) {
      setProjectDraft({ name: "", folderPath: "" });
      return;
    }

    if (project && !thread) {
      setProjectDraft({ name: project.name, folderPath: project.folderPath });
    }
  }, [bootstrap, isNewProjectRoute, params.projectId, params.threadId]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const { thread } = resolveSelection(bootstrap, params.projectId, params.threadId);
    if (!thread) {
      return;
    }

    if (!threadCache[thread.id]) {
      void loadThreadMessages(thread.id).catch((error: Error) => {
        setThreadNotice({ tone: "error", message: error.message });
      });
    }
  }, [bootstrap, params.projectId, params.threadId, threadCache]);

  if (loading) {
    return <EmptyState title="Loading workspace" description="Bootstrap and project state are loading." />;
  }

  if (loadError) {
    return <EmptyState title="Loading failed" description={loadError} />;
  }

  if (!bootstrap?.setupComplete) {
    return <Navigate to="/setup" replace />;
  }

  if (!isNewProjectRoute && params.projectId === undefined && params.threadId === undefined) {
    return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
  }

  const { project, thread } = resolveSelection(bootstrap, params.projectId, params.threadId);

  if (params.projectId !== "new" && params.projectId && !project) {
    return <Navigate to={getFallbackChatPath(bootstrap)} replace />;
  }

  if (params.threadId && !thread) {
    return <Navigate to={project ? buildProjectPath(project.id) : getFallbackChatPath(bootstrap)} replace />;
  }

  const selectedThreadId = thread?.id || null;
  const authUserName = bootstrap.auth.userName || bootstrap.settings.telegramUserName || "User";
  const threadEntry = selectedThreadId ? threadCache[selectedThreadId] : undefined;

  return (
    <WorkspaceFrame
      section="chat"
      userName={authUserName}
      sidebar={
        <ChatSidebar
          projects={bootstrap.projects}
          selectedProjectId={project?.id || null}
          selectedThreadId={selectedThreadId}
          expandedProjectIds={expandedProjectIds}
          onToggleProject={(projectId) =>
            setExpandedProjectIds((current) => ({ ...current, [projectId]: !current[projectId] }))
          }
          onCreateThread={(projectId) => {
            const title = window.prompt("새 thread 제목을 입력하세요.");
            if (!title?.trim()) {
              return;
            }

            void apiFetch<ThreadListItem>(`/api/projects/${projectId}/threads`, {
              method: "POST",
              body: JSON.stringify({ title: title.trim() }),
            })
              .then(async (createdThread) => {
                setFlash("새 thread와 Telegram topic을 생성했습니다.");
                await refreshBootstrap();
                navigate(buildThreadPath(projectId, createdThread.id));
              })
              .catch((error: Error) => {
                setProjectNotice({ tone: "error", message: error.message });
              });
          }}
        />
      }
      sidebarOpen={sidebarOpen}
      onSidebarClose={() => setSidebarOpen(false)}
    >
      <div className={styles.page}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.kicker}>Chat Workspace</span>
            <h1>{thread ? `${project?.name} / ${thread.title}` : project ? project.name : "새 project"}</h1>
          </div>
          <div className={styles.topbarActions}>
            <Button type="button" variant="icon" onClick={() => setSidebarOpen((current) => !current)} aria-label="메뉴">
              <Icon name="menu" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setProjectNotice(null);
                setThreadNotice(null);
                void refreshBootstrap();
              }}
            >
              <Icon name="refresh" />
              새로고침
            </Button>
          </div>
        </header>

        {flash ? (
          <div className={styles.bannerWrap}>
            <Banner tone="success">
              <div className={styles.flashBanner}>
                <span>{flash}</span>
                <button type="button" onClick={() => setFlash(null)}>
                  닫기
                </button>
              </div>
            </Banner>
          </div>
        ) : null}

        {isNewProjectRoute || (project && !thread) ? (
          <ProjectPanel
            project={project}
            isNew={isNewProjectRoute}
            draft={projectDraft}
            onDraftChange={setProjectDraft}
            notice={projectNotice}
            folderBrowserOpen={folderBrowserOpen}
            onOpenFolderBrowser={() => setFolderBrowserOpen(true)}
            onCloseFolderBrowser={() => setFolderBrowserOpen(false)}
            onSave={() => {
              setProjectNotice(null);
              const payload =
                isNewProjectRoute
                  ? { groupName: projectDraft.name, folderPath: projectDraft.folderPath }
                  : { folderPath: projectDraft.folderPath };

              void apiFetch<ProjectTreeRecord | { id: number }>(
                isNewProjectRoute ? "/api/projects" : `/api/projects/${project?.id}`,
                {
                  method: isNewProjectRoute ? "POST" : "PUT",
                  body: JSON.stringify(payload),
                },
              )
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
                  navigate(buildProjectPath(nextProjectId), { replace: true });
                })
                .catch((error: Error) => {
                  setProjectNotice({ tone: "error", message: error.message });
                });
            }}
            onCancel={() => {
              navigate(getFallbackChatPath(bootstrap), { replace: true });
            }}
            onDelete={() => {
              if (!project) {
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
                  setFlash("project를 삭제했습니다.");
                  await refreshBootstrap();
                  navigate(getFallbackChatPath(bootstrap), { replace: true });
                })
                .catch((error: Error) => {
                  setProjectNotice({ tone: "error", message: error.message });
                });
            }}
            onCreateThread={() => {
              if (!project) {
                return;
              }

              const title = window.prompt("새 thread 제목을 입력하세요.");
              if (!title?.trim()) {
                return;
              }

              void apiFetch<ThreadListItem>(`/api/projects/${project.id}/threads`, {
                method: "POST",
                body: JSON.stringify({ title: title.trim() }),
              })
                .then(async (createdThread) => {
                  setFlash("새 thread와 Telegram topic을 생성했습니다.");
                  await refreshBootstrap();
                  navigate(buildThreadPath(project.id, createdThread.id));
                })
                .catch((error: Error) => {
                  setProjectNotice({ tone: "error", message: error.message });
                });
            }}
          />
        ) : thread ? (
          <ThreadPanel
            thread={{
              ...thread,
              running: threadRuntimeStates[thread.id]?.running ?? thread.running,
              queueDepth: threadRuntimeStates[thread.id]?.queueDepth ?? thread.queueDepth,
              currentMode: threadRuntimeStates[thread.id]?.mode ?? thread.currentMode,
            }}
            messages={threadEntry?.messages || []}
            hasMoreBefore={Boolean(threadEntry?.hasMoreBefore)}
            draft={composerDrafts[thread.id] || ""}
            submitting={submittingThreadId === thread.id}
            notice={threadNotice}
            liveStream={liveStreams[thread.id]}
            authUserName={authUserName}
            onDraftChange={(value) => setComposerDrafts((current) => ({ ...current, [thread.id]: value }))}
            onSubmit={() => {
              const content = composerDrafts[thread.id] || "";
              if (!content.trim()) {
                return;
              }

              setSubmittingThreadId(thread.id);
              setThreadNotice(null);
              setComposerDrafts((current) => ({ ...current, [thread.id]: "" }));
              void apiFetch(`/api/threads/${thread.id}/messages`, {
                method: "POST",
                body: JSON.stringify({ content }),
              })
                .then(async () => {
                  await loadThreadMessages(thread.id, "appendNewer");
                })
                .catch(async (error: Error) => {
                  if (error.message.includes("Connected Telegram topic was deleted")) {
                    setFlash("Telegram에서 topic이 삭제되어 연결된 thread도 함께 삭제했습니다.");
                    await refreshBootstrap();
                    navigate(project ? buildProjectPath(project.id) : getFallbackChatPath(bootstrap), { replace: true });
                    return;
                  }

                  setComposerDrafts((current) => ({ ...current, [thread.id]: content }));
                  setThreadNotice({ tone: "error", message: error.message });
                })
                .finally(() => {
                  setSubmittingThreadId(null);
                });
            }}
            onLoadMore={() => {
              setLoadingOlderThreadId(thread.id);
              void loadThreadMessages(thread.id, "prependOlder")
                .catch((error: Error) => {
                  setThreadNotice({ tone: "error", message: error.message });
                })
                .finally(() => {
                  setLoadingOlderThreadId(null);
                });
            }}
            onBack={() => {
              if (project) {
                navigate(buildProjectPath(project.id));
              }
            }}
            onReload={() => {
              setThreadNotice(
                loadingOlderThreadId === thread.id ? { tone: "success", message: "기록을 불러오는 중입니다." } : null,
              );
              void loadThreadMessages(thread.id).catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              });
            }}
          />
        ) : (
          <EmptyState title="프로젝트를 선택하세요" description="좌측 사이드바에서 project를 고르거나 새 project를 생성하세요." />
        )}
      </div>
    </WorkspaceFrame>
  );
}
