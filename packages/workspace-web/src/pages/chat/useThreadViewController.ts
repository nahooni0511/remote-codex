import type {
  AppBootstrap,
  ComposerAttachmentRecord,
  ComposerModelOption,
  MessageRecord,
  ProjectFileNode,
  ProjectGitState,
  ProjectTreeRecord,
  ThreadListItem,
  UserInputAnswers,
} from "@remote-codex/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ChatNotice } from "../../features/chat/notice";
import { ApiError, apiFetch } from "../../lib/api/client";
import type { LiveStreamState } from "../../lib/chat";
import { navigateWithTransition } from "../../lib/navigation";
import { buildProjectPath } from "../../lib/routes";
import type { ComposerSettingsPatch } from "./useChatComposerSettings";

type ThreadRuntimeState = {
  running?: boolean;
  queueDepth?: number;
  mode?: ThreadListItem["currentMode"];
};

type ThreadMessageLoadMode = "reset" | "appendNewer" | "prependOlder";

export function useThreadViewController({
  bootstrap,
  project,
  renderedThread,
  messages,
  hasMoreBefore,
  liveStream,
  authUserName,
  modelOptions,
  gitState,
  threadRuntimeState,
  threadNotice,
  setThreadNotice,
  refreshBootstrap,
  loadThreadMessages,
  updateComposerSettings,
  composerSettingsSyncRef,
  refreshProjectGitState,
  onProjectNotice,
}: {
  bootstrap: AppBootstrap | null;
  project: ProjectTreeRecord | null;
  renderedThread: ThreadListItem | null;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
  liveStream: LiveStreamState | undefined;
  authUserName: string;
  modelOptions: ComposerModelOption[];
  gitState: ProjectGitState | null;
  threadRuntimeState: ThreadRuntimeState | undefined;
  threadNotice: ChatNotice;
  setThreadNotice: Dispatch<SetStateAction<ChatNotice>>;
  refreshBootstrap: () => Promise<unknown>;
  loadThreadMessages: (threadId: number, mode?: ThreadMessageLoadMode) => Promise<unknown>;
  updateComposerSettings: (thread: ThreadListItem, patch: ComposerSettingsPatch) => Promise<void>;
  composerSettingsSyncRef: MutableRefObject<Record<number, Promise<void>>>;
  refreshProjectGitState: (projectId: number) => Promise<void>;
  onProjectNotice: (notice: ChatNotice) => void;
}) {
  const navigate = useNavigate();
  const [composerDrafts, setComposerDrafts] = useState<Record<number, string>>({});
  const [composerAttachments, setComposerAttachments] = useState<Record<number, ComposerAttachmentRecord[]>>({});
  const [filePickerThreadId, setFilePickerThreadId] = useState<number | null>(null);
  const [submittingThreadId, setSubmittingThreadId] = useState<number | null>(null);
  const [undoingTurnRunId, setUndoingTurnRunId] = useState<number | null>(null);
  const [respondingUserInputRequestId, setRespondingUserInputRequestId] = useState<string | null>(null);
  const [stoppingThreadId, setStoppingThreadId] = useState<number | null>(null);

  const refreshThreadBootstrap = async (threadId: number) => {
    await refreshBootstrap();
    await loadThreadMessages(threadId, "reset");
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

  if (!bootstrap || !project || !renderedThread) {
    return {
      attachmentPickerProps: null,
      threadNotice,
      threadViewProps: null,
    };
  }

  const threadId = renderedThread.id;
  const draft = composerDrafts[threadId] || "";
  const attachments = composerAttachments[threadId] || [];
  const liveThread = {
    ...renderedThread,
    running: threadRuntimeState?.running ?? renderedThread.running,
    queueDepth: threadRuntimeState?.queueDepth ?? renderedThread.queueDepth,
    currentMode: threadRuntimeState?.mode ?? renderedThread.currentMode,
  };

  return {
    threadNotice,
    threadViewProps: {
      thread: liveThread,
      messages,
      hasMoreBefore,
      draft,
      submitting: submittingThreadId === threadId,
      notice: threadNotice,
      liveStream,
      authUserName,
      modelOptions,
      gitState,
      attachments,
      undoingTurnRunId,
      respondingUserInputRequestId,
      stoppingThread: stoppingThreadId === threadId,
      onDraftChange: (value: string) => setComposerDrafts((current) => ({ ...current, [threadId]: value })),
      onSubmit: () => {
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
              onProjectNotice({
                tone: "info",
                message: "Telegram에서 topic이 삭제되어 연결된 thread도 함께 삭제했습니다.",
              });
              await refreshBootstrap();
              navigateWithTransition(navigate, buildProjectPath(project.id), { replace: true });
              return;
            }

            setComposerDrafts((current) => ({ ...current, [threadId]: draft }));
            setComposerAttachments((current) => ({ ...current, [threadId]: attachments }));
            setThreadNotice({ tone: "error", message: resolvedError.message });
          } finally {
            setSubmittingThreadId(null);
          }
        })();
      },
      onStop: () => {
        setStoppingThreadId(threadId);
        setThreadNotice(null);
        void stopThreadTurn(threadId)
          .then(async () => {
            await loadThreadMessages(threadId, "appendNewer");
          })
          .catch((error: Error) => {
            setThreadNotice({ tone: "error", message: error.message });
          })
          .finally(() => {
            setStoppingThreadId((current) => (current === threadId ? null : current));
          });
      },
      onLoadMore: () => {
        void loadThreadMessages(threadId, "prependOlder").catch((error: Error) => {
          setThreadNotice({ tone: "error", message: error.message });
        });
      },
      onTogglePlanMode: () => {
        void updateComposerSettings(renderedThread, {
          defaultMode: renderedThread.composerSettings.defaultMode === "plan" ? "default" : "plan",
        }).catch((error: Error) => {
          setThreadNotice({ tone: "error", message: error.message });
        });
      },
      onModelChange: (value: string | null) => {
        void updateComposerSettings(renderedThread, {
          modelOverride: value,
          reasoningEffortOverride: null,
        }).catch((error: Error) => {
          setThreadNotice({ tone: "error", message: error.message });
        });
      },
      onEffortChange: (value: string | null) => {
        void updateComposerSettings(renderedThread, {
          reasoningEffortOverride: value,
        }).catch((error: Error) => {
          setThreadNotice({ tone: "error", message: error.message });
        });
      },
      onPermissionChange: (value: "default" | "danger-full-access") => {
        void updateComposerSettings(renderedThread, {
          permissionMode: value,
        }).catch((error: Error) => {
          setThreadNotice({ tone: "error", message: error.message });
        });
      },
      onBranchChange: (branchName: string) => {
        void apiFetch(`/api/projects/${project.id}/git/branch`, {
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
      },
      onCreateBranch: () => {
        const branchName = window.prompt("새 브랜치 이름을 입력하세요.");
        if (!branchName?.trim()) {
          return;
        }

        void apiFetch(`/api/projects/${project.id}/git/branch`, {
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
      },
      onOpenAttachmentPicker: () => setFilePickerThreadId(threadId),
      onRemoveAttachment: (attachmentId: string) => {
        setComposerAttachments((current) => ({
          ...current,
          [threadId]: (current[threadId] || []).filter((attachment) => attachment.id !== attachmentId),
        }));
      },
      onUndoTurn: (turnRunId: number) => {
        setUndoingTurnRunId(turnRunId);
        setThreadNotice(null);
        void apiFetch(`/api/threads/${threadId}/turns/${turnRunId}/undo`, {
          method: "POST",
        })
          .then(async () => {
            await refreshThreadBootstrap(threadId);
            await refreshProjectGitState(project.id);
          })
          .catch((error: Error) => {
            setThreadNotice({ tone: "error", message: error.message });
          })
          .finally(() => {
            setUndoingTurnRunId(null);
          });
      },
      onSubmitUserInputRequest: (requestId: string, answers: UserInputAnswers) => {
        setRespondingUserInputRequestId(requestId);
        setThreadNotice(null);
        void respondToUserInputRequest(threadId, requestId, answers)
          .then(async () => {
            await loadThreadMessages(threadId, "appendNewer");
          })
          .catch((error: Error) => {
            setThreadNotice({ tone: "error", message: error.message });
          })
          .finally(() => {
            setRespondingUserInputRequestId(null);
          });
      },
      onCancelUserInputRequest: () => {
        setStoppingThreadId(threadId);
        setThreadNotice(null);
        void stopThreadTurn(threadId)
          .then(async () => {
            await loadThreadMessages(threadId, "appendNewer");
          })
          .catch((error: Error) => {
            setThreadNotice({ tone: "error", message: error.message });
          })
          .finally(() => {
            setStoppingThreadId((current) => (current === threadId ? null : current));
          });
      },
    },
    attachmentPickerProps: {
      open: filePickerThreadId === threadId,
      projectId: project.id,
      initialPath: project.folderPath,
      onClose: () => setFilePickerThreadId(null),
      onSelect: (file: ProjectFileNode) => {
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
          [threadId]: [...(current[threadId] || []).filter((entry) => entry.path !== attachment.path), attachment],
        }));
      },
    },
  };
}
