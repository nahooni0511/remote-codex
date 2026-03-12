import type {
  AppBootstrap,
  CronJobListItem,
  MessageRecord,
  RealtimeEvent,
  ThreadListItem,
  ThreadMode,
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

import { apiFetch, buildWsUrl } from "../lib/api/client";
import { type LiveStreamState, mergeThreadMessages, type ThreadMessagesMode } from "../lib/chat";

type ThreadCacheEntry = {
  thread: ThreadListItem | null;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
};

type ThreadRuntimeState = {
  running: boolean;
  queueDepth: number;
  mode: ThreadMode;
};

type AppContextValue = {
  bootstrap: AppBootstrap | null;
  loading: boolean;
  loadError: string | null;
  flash: string | null;
  setFlash: (message: string | null) => void;
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

function pruneByThreadIds<T>(value: Record<number, T>, allowedThreadIds: Set<number>): Record<number, T> {
  return Object.fromEntries(
    Object.entries(value).filter(([threadId]) => allowedThreadIds.has(Number(threadId))),
  ) as Record<number, T>;
}

function buildThreadMessagesUrl(threadId: number, options: { limit?: number; before?: number | null; after?: number | null }) {
  const search = new URLSearchParams();
  if (options.limit) {
    search.set("limit", String(options.limit));
  }
  if (options.before) {
    search.set("before", String(options.before));
  }
  if (options.after) {
    search.set("after", String(options.after));
  }

  const query = search.toString();
  return `/api/threads/${threadId}/messages${query ? `?${query}` : ""}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [bootstrap, setBootstrap] = useState<AppBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [threadCache, setThreadCache] = useState<Record<number, ThreadCacheEntry>>({});
  const [threadRuntimeStates, setThreadRuntimeStates] = useState<Record<number, ThreadRuntimeState>>({});
  const [liveStreams, setLiveStreams] = useState<Record<number, LiveStreamState>>({});
  const [cronJobs, setCronJobs] = useState<CronJobListItem[]>([]);
  const [cronLoading, setCronLoading] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const workspaceRefreshTimerRef = useRef<number | null>(null);
  const threadSyncTimersRef = useRef<Record<number, number>>({});
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
          delete next[threadId];
          return next;
        });
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
      if (event.event.type === "clear") {
        startTransition(() => {
          setLiveStreams((current) => {
            const next = { ...current };
            delete next[event.threadId];
            return next;
          });
        });
        return;
      }

      startTransition(() => {
        setLiveStreams((current) => {
          const next = {
            ...current,
          };
          const entry = next[event.threadId] || {
            reasoningText: "",
            assistantText: "",
            planText: "",
          };

          if (event.event.type === "reasoning-delta") {
            entry.reasoningText += event.event.text || "";
          } else if (event.event.type === "reasoning-complete") {
            entry.reasoningText = event.event.text || "";
          } else if (event.event.type === "assistant-delta") {
            entry.assistantText += event.event.text || "";
          } else if (event.event.type === "assistant-complete" && event.event.phase !== "final_answer") {
            entry.assistantText = event.event.text || "";
          } else if (event.event.type === "plan-updated") {
            const lines: string[] = [];
            if (event.event.explanation) {
              lines.push(event.event.explanation);
            }
            if (Array.isArray(event.event.plan) && event.event.plan.length) {
              if (lines.length) {
                lines.push("");
              }
              event.event.plan.forEach((step) => {
                lines.push(`- [${step.status}] ${step.step}`);
              });
            }
            entry.planText = lines.join("\n").trim();
          }

          next[event.threadId] = entry;
          return next;
        });
      });
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

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      try {
        const socket = new WebSocket(buildWsUrl());
        socketRef.current = socket;

        socket.addEventListener("message", (messageEvent) => {
          try {
            handleRealtimeEvent(JSON.parse(messageEvent.data) as RealtimeEvent);
          } catch (error) {
            console.error("Realtime message parse failed:", error);
          }
        });

        socket.addEventListener("close", () => {
          socketRef.current = null;
          if (!cancelled) {
            reconnectTimerRef.current = window.setTimeout(connect, 1500);
          }
        });

        socket.addEventListener("error", () => {
          socket.close();
        });
      } catch (error) {
        console.error("Realtime socket init failed:", error);
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      }
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
      }
      Object.values(threadSyncTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      socketRef.current?.close();
    };
  }, []);

  return (
    <AppContext.Provider
      value={{
        bootstrap,
        loading,
        loadError,
        flash,
        setFlash,
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
