import { useFocusEffect } from "@react-navigation/native";
import type { RealtimeEvent, ThreadMode, UserInputAnswers } from "@remote-codex/contracts";
import {
  applyThreadStreamEvent,
  mergeThreadMessages as mergeMessages,
  shouldClearLiveStreamForMessages,
} from "@remote-codex/workspace-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import type { PreviewWorkspace } from "../../lib/preview";
import {
  ensureWorkspaceSession,
  fetchWorkspaceMessageAttachment,
  interruptWorkspaceThread,
  loadWorkspaceThreadMessages,
  peekWorkspaceSession,
  peekWorkspaceThreadSnapshot,
  respondWorkspaceUserInputRequest,
  sendWorkspaceThreadMessage,
  subscribeWorkspaceRealtime,
  undoWorkspaceThreadTurn,
  updateWorkspaceComposerSettings,
} from "../../lib/workspace-session";
import type {
  WorkspaceAttachmentPreview,
  WorkspaceModelOption,
  WorkspaceProject,
  WorkspaceThread,
  WorkspaceThreadSnapshot,
} from "../../types";
import type { ComposerSheet, WorkspaceRoutePhase } from "./types";
import {
  createEmptyThreadSnapshot,
  findProject,
  findThread,
  hydrateThreadSnapshot,
  makeOptimisticUserMessage,
  resolveWorkspacePhase,
} from "./utils";

function useAppResumeNonce() {
  const [resumeNonce, setResumeNonce] = useState(0);
  const previousAppState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const lastAppState = previousAppState.current;
      previousAppState.current = nextAppState;

      if (lastAppState !== "active" && nextAppState === "active") {
        setResumeNonce((value) => value + 1);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return resumeNonce;
}

export function useWorkspaceRouteState(authToken: string, deviceId: string | null, preview: PreviewWorkspace | null = null) {
  const resumeNonce = useAppResumeNonce();
  const cached = deviceId ? peekWorkspaceSession(deviceId, preview) : null;
  const [device, setDevice] = useState(cached?.device ?? null);
  const [projects, setProjects] = useState<WorkspaceProject[]>(cached?.projects ?? []);
  const [modelOptions, setModelOptions] = useState<WorkspaceModelOption[]>(cached?.modelOptions ?? []);
  const [error, setError] = useState<string | null>(cached?.error ?? (deviceId ? null : "No device selected."));
  const [errorCode, setErrorCode] = useState<string | null>(cached?.errorCode ?? null);
  const [phase, setPhase] = useState<WorkspaceRoutePhase>(
    deviceId ? (cached ? resolveWorkspacePhase(cached.device, cached.error) : "connecting") : "error",
  );
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    setReloadNonce(0);
  }, [deviceId]);

  const syncFromCache = useCallback(() => {
    if (!deviceId) {
      return;
    }

    const nextCached = peekWorkspaceSession(deviceId, preview);
    if (!nextCached) {
      return;
    }

    setDevice(nextCached.device);
    setProjects(nextCached.projects);
    setModelOptions(nextCached.modelOptions);
    setError(nextCached.error);
    setErrorCode(nextCached.errorCode);
    setPhase(resolveWorkspacePhase(nextCached.device, nextCached.error));
  }, [deviceId, preview]);

  useFocusEffect(
    useCallback(() => {
      syncFromCache();
      return undefined;
    }, [syncFromCache]),
  );

  useEffect(() => {
    let cancelled = false;

    if (!deviceId) {
      setDevice(null);
      setProjects([]);
      setModelOptions([]);
      setError("No device selected.");
      setErrorCode(null);
      setPhase("error");
      return () => {
        cancelled = true;
      };
    }

    const nextCached = peekWorkspaceSession(deviceId, preview);
    if (nextCached) {
      setDevice(nextCached.device);
      setProjects(nextCached.projects);
      setModelOptions(nextCached.modelOptions);
      setError(nextCached.error);
      setErrorCode(nextCached.errorCode);
      setPhase(resolveWorkspacePhase(nextCached.device, nextCached.error));
    } else {
      setDevice(null);
      setProjects([]);
      setModelOptions([]);
      setError(null);
      setErrorCode(null);
      setPhase("connecting");
    }

    void ensureWorkspaceSession({
      authToken,
      deviceId,
      preview,
      forceRefresh: reloadNonce > 0 || resumeNonce > 0,
    })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        setDevice(snapshot.device);
        setProjects(snapshot.projects);
        setModelOptions(snapshot.modelOptions);
        setError(snapshot.error);
        setErrorCode(snapshot.errorCode);
        setPhase(resolveWorkspacePhase(snapshot.device, snapshot.error));
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }

        setDevice(null);
        setProjects([]);
        setModelOptions([]);
        setError(caught instanceof Error ? caught.message : "The selected device could not be opened.");
        setErrorCode(
          caught && typeof caught === "object" && "code" in caught && typeof caught.code === "string" ? caught.code : null,
        );
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [authToken, deviceId, preview, reloadNonce, resumeNonce]);

  return {
    device,
    error,
    errorCode,
    modelOptions,
    phase,
    projects,
    retry: () => setReloadNonce((value) => value + 1),
  };
}

export function useWorkspaceAttachmentPreview({
  authToken,
  deviceId,
  attachmentKind,
  messageId,
  preview,
}: {
  authToken: string;
  deviceId: string;
  attachmentKind: string | null;
  messageId: number;
  preview: PreviewWorkspace | null;
}) {
  const [attachment, setAttachment] = useState<WorkspaceAttachmentPreview | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!attachmentKind) {
      setAttachment(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchWorkspaceMessageAttachment({
      authToken,
      deviceId,
      messageId,
      preview,
    })
      .then((nextAttachment) => {
        if (!cancelled) {
          setAttachment(nextAttachment);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAttachment(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachmentKind, authToken, deviceId, messageId, preview]);

  return attachment;
}

type UseWorkspaceChatControllerArgs = {
  authToken: string;
  authUserName: string;
  deviceId: string;
  phase: WorkspaceRoutePhase;
  preview: PreviewWorkspace | null;
  projectId: number;
  projects: WorkspaceProject[];
  threadId: number;
};

export function useWorkspaceChatController({
  authToken,
  authUserName,
  deviceId,
  phase,
  preview,
  projectId,
  projects,
  threadId,
}: UseWorkspaceChatControllerArgs) {
  const project = findProject(projects, projectId);
  const routeThread = findThread(project, threadId);
  const cachedSnapshot = peekWorkspaceThreadSnapshot(deviceId, threadId, preview);
  const [threadSnapshot, setThreadSnapshot] = useState<WorkspaceThreadSnapshot>(
    hydrateThreadSnapshot(cachedSnapshot || createEmptyThreadSnapshot(routeThread), routeThread),
  );
  const [loadingMessages, setLoadingMessages] = useState(!cachedSnapshot?.messages.length);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [draft, setDraft] = useState("");
  const [activeSheet, setActiveSheet] = useState<ComposerSheet>(null);
  const [updatingControl, setUpdatingControl] = useState<string | null>(null);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [undoingTurnRunId, setUndoingTurnRunId] = useState<number | null>(null);
  const [submittingMessage, setSubmittingMessage] = useState(false);
  const [stoppingThread, setStoppingThread] = useState(false);

  useEffect(() => {
    const nextCached = peekWorkspaceThreadSnapshot(deviceId, threadId, preview);
    if (nextCached) {
      setThreadSnapshot(hydrateThreadSnapshot(nextCached, routeThread));
      setLoadingMessages(false);
      setMessageError(null);
      return;
    }

    setThreadSnapshot(createEmptyThreadSnapshot(routeThread));
    setLoadingMessages(true);
    setMessageError(null);
  }, [deviceId, preview, routeThread, threadId]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};

    async function refresh(forceRefresh = false) {
      const nextSnapshot = await loadWorkspaceThreadMessages({
        authToken,
        deviceId,
        threadId,
        preview,
        forceRefresh,
      });

      if (cancelled) {
        return;
      }

      setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, routeThread));
      setLoadingMessages(false);
      setMessageError(null);
    }

    if (phase !== "ready" || !project || !routeThread) {
      return () => {
        cancelled = true;
      };
    }

    void refresh(reloadNonce > 0).catch((caught) => {
      if (!cancelled) {
        setLoadingMessages(false);
        setMessageError(caught instanceof Error ? caught.message : "Failed to load thread messages.");
      }
    });

    void subscribeWorkspaceRealtime({
      authToken,
      deviceId,
      preview,
      onEvent: (event: RealtimeEvent) => {
        if (cancelled) {
          return;
        }

        if (
          (event.type === "message-event-created" || event.type === "message-event-updated") &&
          event.threadId === threadId
        ) {
          setThreadSnapshot((current) => {
            const nextMessages = mergeMessages(current.messages, [event.event]);
            return {
              ...current,
              thread: current.thread ?? routeThread,
              messages: nextMessages,
              liveStream: shouldClearLiveStreamForMessages(nextMessages, current.thread?.running || false)
                ? null
                : current.liveStream,
            };
          });
          setLoadingMessages(false);
          return;
        }

        if (event.type === "thread-stream-event" && event.threadId === threadId) {
          setThreadSnapshot((current) => ({
            ...current,
            thread: current.thread ?? routeThread,
            liveStream: applyThreadStreamEvent(current.liveStream, event.event),
          }));
          return;
        }

        if (event.type === "thread-turn-state" && event.threadId === threadId) {
          setThreadSnapshot((current) => ({
            ...current,
            thread: current.thread
              ? {
                  ...current.thread,
                  running: event.running,
                  queueDepth: event.queueDepth,
                  currentMode: event.mode,
                }
              : routeThread
                ? {
                    ...routeThread,
                    running: event.running,
                    queueDepth: event.queueDepth,
                    currentMode: event.mode,
                  }
                : current.thread,
          }));
          return;
        }

        if (
          (event.type === "thread-messages-updated" && event.threadId === threadId) ||
          (event.type === "workspace-updated" && (event.threadId === threadId || event.projectId === projectId))
        ) {
          void refresh(true).catch((caught) => {
            if (!cancelled) {
              setMessageError(caught instanceof Error ? caught.message : "Failed to refresh thread.");
            }
          });
        }
      },
    })
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
      })
      .catch((caught) => {
        if (!cancelled) {
          setMessageError(caught instanceof Error ? caught.message : "Realtime sync is unavailable.");
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authToken, deviceId, phase, preview, project, projectId, reloadNonce, routeThread, threadId]);

  const thread = threadSnapshot.thread ?? routeThread;

  async function handleComposerUpdate(
    key: string,
    payload: {
      defaultMode?: ThreadMode;
      modelOverride?: string | null;
      reasoningEffortOverride?: string | null;
      permissionMode?: WorkspaceThread["composerSettings"]["permissionMode"];
    },
  ) {
    if (!thread) {
      return;
    }

    setUpdatingControl(key);
    try {
      const updatedThread = await updateWorkspaceComposerSettings({
        authToken,
        deviceId,
        threadId,
        preview,
        ...payload,
      });
      if (updatedThread) {
        setThreadSnapshot((current) => ({
          ...current,
          thread: updatedThread,
        }));
      }
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to update composer settings.");
    } finally {
      setUpdatingControl(null);
      setActiveSheet(null);
    }
  }

  async function handleSend() {
    if (!thread) {
      return;
    }

    if (thread.running) {
      setStoppingThread(true);
      try {
        const nextSnapshot = await interruptWorkspaceThread({
          authToken,
          deviceId,
          threadId,
          preview,
        });
        setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, thread));
        setMessageError(null);
      } catch (caught) {
        setMessageError(caught instanceof Error ? caught.message : "Failed to stop the current turn.");
      } finally {
        setStoppingThread(false);
      }
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    const optimisticMessage = makeOptimisticUserMessage(threadId, trimmed, authUserName);
    setDraft("");
    setSubmittingMessage(true);
    setMessageError(null);
    setThreadSnapshot((current) => ({
      ...current,
      thread: current.thread ?? thread,
      messages: mergeMessages(current.messages, [optimisticMessage]),
      liveStream: null,
    }));

    try {
      const nextSnapshot = await sendWorkspaceThreadMessage({
        authToken,
        deviceId,
        threadId,
        preview,
        content: trimmed,
      });
      setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, thread));
    } catch (caught) {
      setDraft(trimmed);
      setThreadSnapshot((current) => ({
        ...current,
        messages: current.messages.filter((message) => message.id !== optimisticMessage.id),
      }));
      setMessageError(caught instanceof Error ? caught.message : "Failed to send the message.");
    } finally {
      setSubmittingMessage(false);
    }
  }

  async function handleSubmitUserInputRequest(requestId: string, answers: UserInputAnswers) {
    if (!thread) {
      return;
    }

    setRespondingRequestId(requestId);
    try {
      const nextSnapshot = await respondWorkspaceUserInputRequest({
        authToken,
        deviceId,
        threadId,
        requestId,
        answers,
        preview,
      });
      setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, thread));
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to submit the selection.");
    } finally {
      setRespondingRequestId(null);
    }
  }

  async function handleUndoTurn(turnRunId: number) {
    if (!thread) {
      return;
    }

    setUndoingTurnRunId(turnRunId);
    try {
      const nextSnapshot = await undoWorkspaceThreadTurn({
        authToken,
        deviceId,
        threadId,
        turnRunId,
        preview,
      });
      setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, thread));
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to undo the latest turn.");
    } finally {
      setUndoingTurnRunId(null);
    }
  }

  async function handleCancelUserInputRequest() {
    if (!thread) {
      return;
    }

    setStoppingThread(true);
    try {
      const nextSnapshot = await interruptWorkspaceThread({
        authToken,
        deviceId,
        threadId,
        preview,
      });
      setThreadSnapshot(hydrateThreadSnapshot(nextSnapshot, thread));
      setMessageError(null);
    } catch (caught) {
      setMessageError(caught instanceof Error ? caught.message : "Failed to cancel the request.");
    } finally {
      setStoppingThread(false);
    }
  }

  return {
    activeSheet,
    draft,
    loadingMessages,
    messageError,
    project,
    respondingRequestId,
    routeThread,
    setActiveSheet,
    setDraft,
    setReloadNonce,
    stoppingThread,
    submittingMessage,
    thread,
    threadSnapshot,
    undoingTurnRunId,
    updatingControl,
    handleCancelUserInputRequest,
    handleComposerUpdate,
    handleSend,
    handleSubmitUserInputRequest,
    handleUndoTurn,
  };
}
