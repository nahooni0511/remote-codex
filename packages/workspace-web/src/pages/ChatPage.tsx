import type {
  AppBootstrap,
  ComposerAttachmentRecord,
  ProjectFileNode,
  ProjectGitState,
  ProjectGitStateResponse,
  ProjectTreeRecord,
  ThreadComposerSettings,
  ThreadComposerSettingsResponse,
  ThreadListItem,
  UserInputAnswers,
} from "@remote-codex/contracts";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { useAppContext } from "../app/AppProvider";
import { WorkspaceFrame } from "../components/layout/WorkspaceFrame";
import { ProjectFilePicker } from "../components/ui/ProjectFilePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { ChatSidebar } from "../features/chat/ChatSidebar";
import type { ChatNotice } from "../features/chat/notice";
import { ApiError, apiFetch } from "../lib/api/client";
import { navigateWithTransition } from "../lib/navigation";
import { buildProjectPath, buildThreadPath, getFallbackChatPath } from "../lib/routes";
import { getWorkspaceUserName } from "../lib/workspace";
import { ProjectChatView } from "./chat/ProjectChatView";
import { ThreadChatView } from "./chat/ThreadChatView";
import styles from "./ChatPage.module.css";

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
    refreshBootstrap,
    loadThreadMessages,
    threadCache,
    threadRuntimeStates,
    liveStreams,
  } = useAppContext();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<number, boolean>>({});
  const [projectDraft, setProjectDraft] = useState({ name: "", folderPath: "" });
  const [projectNotice, setProjectNotice] = useState<ChatNotice>(null);
  const [threadNotice, setThreadNotice] = useState<ChatNotice>(null);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState<Record<number, string>>({});
  const [composerAttachments, setComposerAttachments] = useState<Record<number, ComposerAttachmentRecord[]>>({});
  const [projectGitStates, setProjectGitStates] = useState<Record<number, ProjectGitState>>({});
  const [filePickerThreadId, setFilePickerThreadId] = useState<number | null>(null);
  const [submittingThreadId, setSubmittingThreadId] = useState<number | null>(null);
  const [undoingTurnRunId, setUndoingTurnRunId] = useState<number | null>(null);
  const [respondingUserInputRequestId, setRespondingUserInputRequestId] = useState<string | null>(null);
  const [stoppingThreadId, setStoppingThreadId] = useState<number | null>(null);
  const [composerSettingsDrafts, setComposerSettingsDrafts] = useState<Record<number, ThreadComposerSettings>>({});
  const composerSettingsDraftsRef = useRef(composerSettingsDrafts);
  const composerSettingsSyncRef = useRef<Record<number, Promise<void>>>({});

  useEffect(() => {
    composerSettingsDraftsRef.current = composerSettingsDrafts;
  }, [composerSettingsDrafts]);

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
    if (!thread || threadCache[thread.id]) {
      return;
    }

    void loadThreadMessages(thread.id).catch((error: Error) => {
      setThreadNotice({ tone: "error", message: error.message });
    });
  }, [bootstrap, loadThreadMessages, params.projectId, params.threadId, threadCache]);

  useEffect(() => {
    if (!bootstrap) {
      return;
    }

    const { project, thread } = resolveSelection(bootstrap, params.projectId, params.threadId);
    if (!project || !thread) {
      return;
    }

    void apiFetch<ProjectGitStateResponse>(`/api/projects/${project.id}/git`)
      .then((payload) => {
        setProjectGitStates((current) => ({ ...current, [project.id]: payload.git }));
      })
      .catch((error: Error) => {
        setThreadNotice({ tone: "error", message: error.message });
      });
  }, [bootstrap, params.projectId, params.threadId]);

  if (loading) {
    return <EmptyState title="Loading workspace" description="Bootstrap and project state are loading." />;
  }

  if (loadError) {
    return <EmptyState title="Loading failed" description={loadError} />;
  }

  if (!bootstrap) {
    return <EmptyState title="Workspace unavailable" description="Bootstrap payload is missing." />;
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
  const authUserName = getWorkspaceUserName(bootstrap);
  const threadEntry = selectedThreadId ? threadCache[selectedThreadId] : undefined;
  const gitState = project ? projectGitStates[project.id] || null : null;
  const modelOptions = bootstrap.configOptions.codexModels || [];
  const renderedThread =
    thread && composerSettingsDrafts[thread.id]
      ? {
          ...thread,
          composerSettings: composerSettingsDrafts[thread.id],
        }
      : thread;

  const refreshProjectGitState = async (projectId: number) => {
    const payload = await apiFetch<ProjectGitStateResponse>(`/api/projects/${projectId}/git`);
    setProjectGitStates((current) => ({ ...current, [projectId]: payload.git }));
  };

  const refreshThreadBootstrap = async (threadId: number) => {
    await refreshBootstrap();
    await loadThreadMessages(threadId, "reset");
  };

  const applyComposerSettingsPatch = (
    current: ThreadComposerSettings,
    patch: {
      defaultMode?: "default" | "plan";
      modelOverride?: string | null;
      reasoningEffortOverride?: string | null;
      permissionMode?: "default" | "danger-full-access";
    },
  ): ThreadComposerSettings => ({
    defaultMode: patch.defaultMode ?? current.defaultMode,
    modelOverride: patch.modelOverride === undefined ? current.modelOverride : patch.modelOverride,
    reasoningEffortOverride:
      patch.reasoningEffortOverride === undefined ? current.reasoningEffortOverride : patch.reasoningEffortOverride,
    permissionMode: patch.permissionMode ?? current.permissionMode,
  });

  const updateComposerSettings = async (
    threadValue: ThreadListItem,
    patch: {
      defaultMode?: "default" | "plan";
      modelOverride?: string | null;
      reasoningEffortOverride?: string | null;
      permissionMode?: "default" | "danger-full-access";
    },
  ) => {
    const currentSettings = composerSettingsDraftsRef.current[threadValue.id] || threadValue.composerSettings;
    const nextSettings = applyComposerSettingsPatch(currentSettings, patch);

    setComposerSettingsDrafts((current) => ({
      ...current,
      [threadValue.id]: nextSettings,
    }));

    const previousTask = composerSettingsSyncRef.current[threadValue.id] || Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(async () => {
        await apiFetch<ThreadComposerSettingsResponse>(`/api/threads/${threadValue.id}/composer-settings`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        await refreshBootstrap();
        setComposerSettingsDrafts((current) => {
          const next = { ...current };
          delete next[threadValue.id];
          return next;
        });
      })
      .catch((error) => {
        setComposerSettingsDrafts((current) => {
          const next = { ...current };
          delete next[threadValue.id];
          return next;
        });
        throw error;
      })
      .finally(() => {
        if (composerSettingsSyncRef.current[threadValue.id] === nextTask) {
          delete composerSettingsSyncRef.current[threadValue.id];
        }
      });

    composerSettingsSyncRef.current[threadValue.id] = nextTask;
    await nextTask;
  };

  const respondToUserInputRequest = async (threadId: number, requestId: string, answers: UserInputAnswers) => {
    await apiFetch(`/api/threads/${threadId}/user-input-requests/${encodeURIComponent(requestId)}/respond`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  };

  const stopThreadTurn = async (threadId: number) => {
    await apiFetch(`/api/threads/${threadId}/interrupt`, {
      method: "POST",
    });
  };

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

  let content: React.ReactNode;

  if (isNewProjectRoute || (project && !thread)) {
    content = (
      <ProjectChatView
        project={project}
        isNew={isNewProjectRoute}
        draft={projectDraft}
        notice={projectNotice}
        folderBrowserOpen={folderBrowserOpen}
        onDraftChange={setProjectDraft}
        onOpenFolderBrowser={() => setFolderBrowserOpen(true)}
        onCloseFolderBrowser={() => setFolderBrowserOpen(false)}
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        onSave={() => {
          setProjectNotice(null);
          const payload = isNewProjectRoute
            ? { name: projectDraft.name, folderPath: projectDraft.folderPath }
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
              navigateWithTransition(navigate, buildProjectPath(nextProjectId), { replace: true });
            })
            .catch((error: Error) => {
              setProjectNotice({ tone: "error", message: error.message });
            });
        }}
        onCancel={() => {
          navigateWithTransition(navigate, getFallbackChatPath(bootstrap), { replace: true });
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
              await refreshBootstrap();
              navigateWithTransition(navigate, getFallbackChatPath(bootstrap), { replace: true });
            })
            .catch((error: Error) => {
              setProjectNotice({ tone: "error", message: error.message });
            });
        }}
        onCreateThread={() => {
          if (!project) {
            return;
          }

          setProjectNotice(null);
          createThreadInProject(project.id, (error) => {
            setProjectNotice({ tone: "error", message: error.message });
          });
        }}
      />
    );
  } else if (renderedThread && project) {
    content = (
      <>
        <ThreadChatView
          thread={{
            ...renderedThread,
            running: threadRuntimeStates[renderedThread.id]?.running ?? renderedThread.running,
            queueDepth: threadRuntimeStates[renderedThread.id]?.queueDepth ?? renderedThread.queueDepth,
            currentMode: threadRuntimeStates[renderedThread.id]?.mode ?? renderedThread.currentMode,
          }}
          messages={threadEntry?.messages || []}
          hasMoreBefore={Boolean(threadEntry?.hasMoreBefore)}
          draft={composerDrafts[renderedThread.id] || ""}
          submitting={submittingThreadId === renderedThread.id}
          notice={threadNotice}
          liveStream={liveStreams[renderedThread.id]}
          authUserName={authUserName}
          modelOptions={modelOptions}
          gitState={gitState}
          attachments={composerAttachments[renderedThread.id] || []}
          undoingTurnRunId={undoingTurnRunId}
          respondingUserInputRequestId={respondingUserInputRequestId}
          stoppingThread={stoppingThreadId === renderedThread.id}
          onDraftChange={(value) => setComposerDrafts((current) => ({ ...current, [renderedThread.id]: value }))}
          onSubmit={() => {
            const threadId = renderedThread.id;
            const draft = composerDrafts[threadId] || "";
            const attachments = composerAttachments[threadId] || [];
            if (!draft.trim() && !attachments.length) {
              return;
            }

            setSubmittingThreadId(threadId);
            setThreadNotice(null);
            setComposerDrafts((current) => ({ ...current, [threadId]: "" }));
            setComposerAttachments((current) => ({ ...current, [threadId]: [] }));
            void (async () => {
              try {
                const pendingComposerSync = composerSettingsSyncRef.current[threadId];
                if (pendingComposerSync) {
                  await pendingComposerSync;
                }

                await apiFetch(`/api/threads/${threadId}/messages`, {
                  method: "POST",
                  body: JSON.stringify({ content: draft, attachments }),
                });
                await loadThreadMessages(threadId, "appendNewer");
              } catch (error) {
                const resolvedError = error as Error;
                if (resolvedError instanceof ApiError && resolvedError.code === "TURN_INTERRUPTED") {
                  await loadThreadMessages(threadId, "appendNewer");
                  return;
                }

                if (resolvedError.message.includes("Connected Telegram topic was deleted")) {
                  setProjectNotice({
                    tone: "info",
                    message: "Telegram에서 topic이 삭제되어 연결된 thread도 함께 삭제했습니다.",
                  });
                  await refreshBootstrap();
                  navigateWithTransition(
                    navigate,
                    project ? buildProjectPath(project.id) : getFallbackChatPath(bootstrap),
                    { replace: true },
                  );
                  return;
                }

                setComposerDrafts((current) => ({ ...current, [threadId]: draft }));
                setComposerAttachments((current) => ({ ...current, [threadId]: attachments }));
                setThreadNotice({ tone: "error", message: resolvedError.message });
              } finally {
                setSubmittingThreadId(null);
              }
            })();
          }}
          onStop={() => {
            setStoppingThreadId(renderedThread.id);
            setThreadNotice(null);
            void stopThreadTurn(renderedThread.id)
              .then(async () => {
                await loadThreadMessages(renderedThread.id, "appendNewer");
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              })
              .finally(() => {
                setStoppingThreadId((current) => (current === renderedThread.id ? null : current));
              });
          }}
          onLoadMore={() => {
            void loadThreadMessages(renderedThread.id, "prependOlder")
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              });
          }}
          onTogglePlanMode={() => {
            void updateComposerSettings(renderedThread, {
              defaultMode: renderedThread.composerSettings.defaultMode === "plan" ? "default" : "plan",
            }).catch((error: Error) => {
              setThreadNotice({ tone: "error", message: error.message });
            });
          }}
          onModelChange={(value) => {
            void updateComposerSettings(renderedThread, {
              modelOverride: value,
              reasoningEffortOverride: null,
            }).catch((error: Error) => {
              setThreadNotice({ tone: "error", message: error.message });
            });
          }}
          onEffortChange={(value) => {
            void updateComposerSettings(renderedThread, {
              reasoningEffortOverride: value,
            }).catch((error: Error) => {
              setThreadNotice({ tone: "error", message: error.message });
            });
          }}
          onPermissionChange={(value) => {
            void updateComposerSettings(renderedThread, {
              permissionMode: value,
            }).catch((error: Error) => {
              setThreadNotice({ tone: "error", message: error.message });
            });
          }}
          onBranchChange={(branchName) => {
            void apiFetch<ProjectGitStateResponse>(`/api/projects/${project.id}/git/branch`, {
              method: "POST",
              body: JSON.stringify({ branchName }),
            })
              .then(async () => {
                await refreshProjectGitState(project.id);
                setThreadNotice({ tone: "success", message: `브랜치를 ${branchName}으로 전환했습니다.` });
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              });
          }}
          onCreateBranch={() => {
            const branchName = window.prompt("새 브랜치 이름을 입력하세요.");
            if (!branchName?.trim()) {
              return;
            }

            void apiFetch<ProjectGitStateResponse>(`/api/projects/${project.id}/git/branch`, {
              method: "POST",
              body: JSON.stringify({ branchName: branchName.trim(), createNew: true }),
            })
              .then(async () => {
                await refreshProjectGitState(project.id);
                setThreadNotice({ tone: "success", message: "새 브랜치를 생성했습니다." });
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              });
          }}
          onOpenAttachmentPicker={() => setFilePickerThreadId(renderedThread.id)}
          onRemoveAttachment={(attachmentId) => {
            setComposerAttachments((current) => ({
              ...current,
              [renderedThread.id]: (current[renderedThread.id] || []).filter((attachment) => attachment.id !== attachmentId),
            }));
          }}
          onUndoTurn={(turnRunId) => {
            setUndoingTurnRunId(turnRunId);
            setThreadNotice(null);
            void apiFetch(`/api/threads/${renderedThread.id}/turns/${turnRunId}/undo`, {
              method: "POST",
            })
              .then(async () => {
                await refreshThreadBootstrap(renderedThread.id);
                await refreshProjectGitState(project.id);
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              })
              .finally(() => {
                setUndoingTurnRunId(null);
              });
          }}
          onSubmitUserInputRequest={(requestId, answers) => {
            setRespondingUserInputRequestId(requestId);
            setThreadNotice(null);
            void respondToUserInputRequest(renderedThread.id, requestId, answers)
              .then(async () => {
                await loadThreadMessages(renderedThread.id, "appendNewer");
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              })
              .finally(() => {
                setRespondingUserInputRequestId(null);
              });
          }}
          onCancelUserInputRequest={() => {
            setStoppingThreadId(renderedThread.id);
            setThreadNotice(null);
            void stopThreadTurn(renderedThread.id)
              .then(async () => {
                await loadThreadMessages(renderedThread.id, "appendNewer");
              })
              .catch((error: Error) => {
                setThreadNotice({ tone: "error", message: error.message });
              })
              .finally(() => {
                setStoppingThreadId((current) => (current === renderedThread.id ? null : current));
              });
          }}
        />

        <ProjectFilePicker
          open={filePickerThreadId === renderedThread.id}
          projectId={project.id}
          initialPath={project.folderPath}
          onClose={() => setFilePickerThreadId(null)}
          onSelect={(file: ProjectFileNode) => {
            const attachment: ComposerAttachmentRecord = {
              id: file.path,
              name: file.name,
              path: file.path,
              relativePath: file.relativePath,
              source: "project-file",
              mimeType: null,
            };
            setComposerAttachments((current) => ({
              ...current,
              [renderedThread.id]: [
                ...(current[renderedThread.id] || []).filter((entry) => entry.path !== attachment.path),
                attachment,
              ],
            }));
          }}
        />
      </>
    );
  } else {
    content = (
      <EmptyState title="프로젝트를 선택하세요" description="좌측 사이드바에서 project를 고르거나 새 project를 생성하세요." />
    );
  }

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
            setProjectNotice(null);
            createThreadInProject(projectId, (error) => {
              setProjectNotice({ tone: "error", message: error.message });
            });
          }}
        />
      }
      sidebarOpen={sidebarOpen}
      onSidebarClose={() => setSidebarOpen(false)}
    >
      <div className={styles.page}>{content}</div>
    </WorkspaceFrame>
  );
}
