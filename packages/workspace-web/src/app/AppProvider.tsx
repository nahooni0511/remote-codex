import type {
  AppBootstrap,
  CronJobListItem,
  RealtimeEvent,
  ThreadStreamRealtimeEvent,
  ThreadMessagesResponse,
} from "@remote-codex/contracts";
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { apiFetch, connectRealtime } from "../lib/api/client";
import { type LiveStreamState, mergeThreadMessages, type ThreadMessagesMode } from "../lib/chat";
import { useRealtimeConnection } from "./useRealtimeConnection";
import {
  applyThreadStreamEvent,
  buildThreadMessagesUrl,
  pruneByThreadIds,
  shouldClearLiveStreamForMessages,
  type ThreadCacheEntry,
  type ThreadRuntimeState,
} from "./workspace-helpers";

type AppContextValue = {
  bootstrap: AppBootstrap | null;
  loading: boolean;
  loadError: string | null;
  threadCache: Record<number, ThreadCacheEntry>;
  threadRuntimeStates: Record<number, ThreadRuntimeState>;
  liveStreams: Record<number, LiveStreamState>;
  cronJobs: CronJobListItem[];
  cronLoading: boolean;
  refreshBootstrap: () => Promise<AppBootstrap>;
  loadThreadMessages: (threadId: number, mode?: ThreadMessagesMode) => Promise<void>;
  loadCronJobs: () => Promise<void>;
};

const THREAD_MESSAGE_PAGE_SIZE = 30;

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [threadCache, setThreadCache] = useState<Record<number, ThreadCacheEntry>>({});
  const [threadRuntimeStates, setThreadRuntimeStates] = useState<Record<number, ThreadRuntimeState>>({});
  const [liveStreams, setLiveStreams] = useState<Record<number, LiveStreamState>>({});
  const [cronJobs, setCronJobs] = useState<CronJobListItem[]>([]);
  const [cronLoading, setCronLoading] = useState(false);

  const workspaceRefreshTimerRef = useRef<number | null>(null);
  const threadSyncTimersRef = useRef<Record<number, number>>({});
  const liveStreamBuffersRef = useRef<Record<number, ThreadStreamRealtimeEvent[]>>({});
  const liveStreamFlushTimerRef = useRef<number | null>(null);
  const threadCacheRef = useRef(threadCache);

  useEffect(() => {
    threadCacheRef.current = threadCache;
  }, [threadCache]);

  const refreshBootstrap = useEffectEvent(async () => {
    const data = await apiFetch<AppBootstrap>("/api/bootstrap");
    const activeThreadIds = new Set(data.projects.flatMap((project) => project.threads.map((thread) => thread.id)));

    startTransition(() => {
      setBootstrap(data);
      setLoadError(null);
      setLoading(false);
      setThreadCache((current) => pruneByThreadIds(current, activeThreadIds));
      setThreadRuntimeStates((current) => pruneByThreadIds(current, activeThreadIds));
      setLiveStreams((current) => pruneByThreadIds(current, activeThreadIds));
    });

    return data;
  });

  const loadThreadMessages = useEffectEvent(async (threadId: number, mode: ThreadMessagesMode = "reset") => {
    const existingCache = threadCacheRef.current[threadId] || {
      thread: null,
      messages: [],
      hasMoreBefore: false,
    };
    const oldestMessageId = existingCache.messages[0]?.id || null;
    const newestMessageId = existingCache.messages[existingCache.messages.length - 1]?.id || null;

    let requestUrl = buildThreadMessagesUrl(threadId, { limit: THREAD_MESSAGE_PAGE_SIZE });

    if (mode === "prependOlder" && oldestMessageId) {
      requestUrl = buildThreadMessagesUrl(threadId, {
        limit: THREAD_MESSAGE_PAGE_SIZE,
        before: oldestMessageId,
      });
    } else if (mode === "appendNewer" && newestMessageId) {
      requestUrl = buildThreadMessagesUrl(threadId, { after: newestMessageId });
    }

    const data = await apiFetch<ThreadMessagesResponse>(requestUrl);
    const incomingMessages = Array.isArray(data.messages) ? data.messages : [];
    let messages = incomingMessages;
    let hasMoreBefore = Boolean(data.hasMoreBefore);
    const shouldClearAppendedLiveStream = shouldClearLiveStreamForMessages(
      incomingMessages,
      Boolean(data.thread?.running),
    );

    if (mode === "prependOlder" && oldestMessageId) {
      messages = mergeThreadMessages(existingCache.messages, incomingMessages, "prepend");
    } else if (mode === "appendNewer" && newestMessageId) {
      messages = mergeThreadMessages(existingCache.messages, incomingMessages, "append");
      hasMoreBefore = Boolean(existingCache.hasMoreBefore);
    }

    startTransition(() => {
      setThreadCache((current) => ({
        ...current,
        [threadId]: {
          ...existingCache,
          ...data,
          messages,
          hasMoreBefore,
        },
      }));
      setThreadRuntimeStates((current) => ({
        ...current,
        [threadId]: {
          running: Boolean(data.thread?.running),
          queueDepth: Number(data.thread?.queueDepth || 0),
          mode: data.thread?.currentMode || null,
        },
      }));
      if (mode === "reset") {
        setLiveStreams((current) => {
          const next = { ...current };
          if (data.liveStream && data.thread?.running) {
            next[threadId] = {
              reasoningText: data.liveStream.reasoningText || "",
              assistantText: data.liveStream.assistantText || "",
              planText: data.liveStream.planText || "",
            };
          } else {
            delete next[threadId];
          }
          return next;
        });
        delete liveStreamBuffersRef.current[threadId];
      } else if (mode === "appendNewer" && shouldClearAppendedLiveStream) {
        setLiveStreams((current) => {
          if (!current[threadId]) {
            return current;
          }

          const next = { ...current };
          delete next[threadId];
          return next;
        });
        delete liveStreamBuffersRef.current[threadId];
      }
    });
  });

  const loadCronJobs = useEffectEvent(async () => {
    setCronLoading(true);
    try {
      const data = await apiFetch<{ jobs: CronJobListItem[] }>("/api/cron-jobs");
      startTransition(() => {
        setCronJobs(Array.isArray(data.jobs) ? data.jobs : []);
      });
    } finally {
      setCronLoading(false);
    }
  });

  const scheduleWorkspaceSync = useEffectEvent((delay = 120) => {
    if (workspaceRefreshTimerRef.current) {
      window.clearTimeout(workspaceRefreshTimerRef.current);
    }

    workspaceRefreshTimerRef.current = window.setTimeout(() => {
      workspaceRefreshTimerRef.current = null;
      void refreshBootstrap().catch((error: Error) => {
        console.error("Realtime workspace sync failed:", error);
      });
    }, delay);
  });

  const scheduleThreadSync = useEffectEvent((threadId: number, delay = 40) => {
    const existingTimer = threadSyncTimersRef.current[threadId];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    threadSyncTimersRef.current[threadId] = window.setTimeout(() => {
      delete threadSyncTimersRef.current[threadId];
      void loadThreadMessages(threadId, "appendNewer").catch((error: Error) => {
        console.error("Realtime thread sync failed:", error);
      });
    }, delay);
  });

  const flushBufferedLiveStreams = useEffectEvent(() => {
    const buffered = liveStreamBuffersRef.current;
    liveStreamBuffersRef.current = {};
    if (liveStreamFlushTimerRef.current) {
      window.clearTimeout(liveStreamFlushTimerRef.current);
      liveStreamFlushTimerRef.current = null;
    }

    const entries = Object.entries(buffered);
    if (!entries.length) {
      return;
    }

    startTransition(() => {
      setLiveStreams((current) => {
        const next = { ...current };

        entries.forEach(([threadIdText, events]) => {
          const threadId = Number(threadIdText);
          let snapshot: LiveStreamState | undefined = next[threadId];

          events.forEach((streamEvent) => {
            snapshot = applyThreadStreamEvent(snapshot, streamEvent) || undefined;
          });

          if (snapshot) {
            next[threadId] = snapshot;
          } else {
            delete next[threadId];
          }
        });

        return next;
      });
    });
  });

  const queueLiveStreamEvent = useEffectEvent((threadId: number, event: ThreadStreamRealtimeEvent) => {
    if (event.type === "clear") {
      delete liveStreamBuffersRef.current[threadId];
      flushBufferedLiveStreams();
      startTransition(() => {
        setLiveStreams((current) => {
          if (!current[threadId]) {
            return current;
          }

          const next = { ...current };
          delete next[threadId];
          return next;
        });
      });
      return;
    }

    const existing = liveStreamBuffersRef.current[threadId] || [];
    liveStreamBuffersRef.current[threadId] = [...existing, event];

    if (liveStreamFlushTimerRef.current) {
      return;
    }

    liveStreamFlushTimerRef.current = window.setTimeout(() => {
      flushBufferedLiveStreams();
    }, 60);
  });

  const handleRealtimeEvent = useEffectEvent((event: RealtimeEvent) => {
    if (!event || typeof event.type !== "string") {
      return;
    }

    if (event.type === "thread-turn-state") {
      startTransition(() => {
        setThreadRuntimeStates((current) => ({
          ...current,
          [event.threadId]: {
            running: Boolean(event.running),
            queueDepth: Number(event.queueDepth || 0),
            mode: event.mode || null,
          },
        }));
      });
      return;
    }

    if (event.type === "thread-stream-event") {
      queueLiveStreamEvent(event.threadId, event.event);
      return;
    }

    if (event.type === "thread-messages-updated") {
      scheduleThreadSync(event.threadId);
      scheduleWorkspaceSync();
      return;
    }

    if (event.type === "workspace-updated") {
      scheduleWorkspaceSync();
    }
  });

  useEffect(() => {
    void refreshBootstrap().catch((error: Error) => {
      setLoadError(error.message);
      setLoading(false);
    });
  }, []);

  const connectRealtimeBridge = useEffectEvent(async () =>
    connectRealtime(handleRealtimeEvent, () => {
      console.warn("Realtime socket closed, retrying...");
    }),
  );

  const handleRealtimeRetry = useEffectEvent(() => {
    console.warn("Realtime socket init failed, retrying...");
  });

  useRealtimeConnection({
    connect: connectRealtimeBridge,
    onRetry: handleRealtimeRetry,
  });

  useEffect(() => {
    return () => {
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
      }
      if (liveStreamFlushTimerRef.current) {
        window.clearTimeout(liveStreamFlushTimerRef.current);
      }
      Object.values(threadSyncTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, []);

  return (
    <AppContext.Provider
      value={{
        bootstrap,
        loading,
        loadError,
        threadCache,
        threadRuntimeStates,
        liveStreams,
        cronJobs,
        cronLoading,
        refreshBootstrap,
        loadThreadMessages,
        loadCronJobs,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppProvider");
  }

  return context;
}
