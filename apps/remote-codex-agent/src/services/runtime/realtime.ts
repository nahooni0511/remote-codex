import type { Server as HttpServer } from "node:http";

import { WebSocket, WebSocketServer } from "ws";
import type {
  CodexPlanStep,
  RealtimeEvent,
  ThreadComposerSettings,
  ThreadLiveStreamSnapshot,
  ThreadMode,
  ThreadStreamRealtimeEvent,
} from "@remote-codex/contracts";

import type { ThreadRecord } from "../../db";
import { getCodexSettings } from "../../db";
import { publishRelayRealtimeEvent } from "../relay-bridge";

type ThreadQueueState = {
  tail: Promise<void>;
  queueDepth: number;
  running: boolean;
  mode: ThreadMode;
};

const websocketClients = new Set<WebSocket>();
const threadQueueStates = new Map<number, ThreadQueueState>();
const threadLiveSnapshots = new Map<number, ThreadLiveStreamSnapshot>();

function buildPlanUpdateText(explanation: string | null | undefined, plan: CodexPlanStep[]): string {
  const lines: string[] = [];
  if (explanation?.trim()) {
    lines.push(explanation.trim());
  }

  if (plan.length) {
    if (lines.length) {
      lines.push("");
    }

    for (const step of plan) {
      lines.push(`- [${step.status}] ${step.step}`);
    }
  }

  return lines.join("\n").trim();
}

export function getThreadQueueSnapshot(threadId: number): {
  running: boolean;
  queueDepth: number;
  mode: ThreadMode;
} {
  const state = threadQueueStates.get(threadId);
  return {
    running: Boolean(state?.running),
    queueDepth: state?.queueDepth ?? 0,
    mode: state?.mode ?? null,
  };
}

export function getStoredThreadCodexConfig(thread: ThreadRecord): {
  effectiveModel: string;
  effectiveReasoningEffort: string;
  composerSettings: ThreadComposerSettings;
} {
  const globalSettings = getCodexSettings();
  return {
    effectiveModel: thread.codexModelOverride || globalSettings.defaultModel || "",
    effectiveReasoningEffort:
      thread.codexReasoningEffortOverride || globalSettings.defaultReasoningEffort || "",
    composerSettings: {
      defaultMode: thread.defaultMode,
      modelOverride: thread.codexModelOverride,
      reasoningEffortOverride: thread.codexReasoningEffortOverride,
      permissionMode: thread.codexPermissionMode,
    },
  };
}

function applyThreadStreamEventToSnapshot(
  current: ThreadLiveStreamSnapshot | undefined,
  event: ThreadStreamRealtimeEvent,
): ThreadLiveStreamSnapshot | null {
  if (event.type === "clear") {
    return null;
  }

  const next: ThreadLiveStreamSnapshot = current
    ? { ...current }
    : {
        reasoningText: "",
        assistantText: "",
        planText: "",
      };

  if (event.type === "reasoning-delta") {
    next.reasoningText += event.text || "";
  } else if (event.type === "reasoning-complete") {
    next.reasoningText = event.text || "";
  } else if (event.type === "assistant-delta") {
    next.assistantText += event.text || "";
  } else if (event.type === "assistant-complete" && event.phase !== "final_answer") {
    next.assistantText = event.text || "";
  } else if (event.type === "plan-updated") {
    next.planText = buildPlanUpdateText(event.explanation, event.plan || []);
  }

  if (!next.reasoningText && !next.assistantText && !next.planText) {
    return null;
  }

  return next;
}

export function getThreadLiveSnapshot(threadId: number): ThreadLiveStreamSnapshot | null {
  return threadLiveSnapshots.get(threadId) || null;
}

function broadcastRealtimeEvent(event: RealtimeEvent): void {
  if (!websocketClients.size) {
    publishRelayRealtimeEvent(event);
    return;
  }

  const payload = JSON.stringify(event);
  for (const client of websocketClients) {
    if (client.readyState !== WebSocket.OPEN) {
      websocketClients.delete(client);
      continue;
    }

    client.send(payload);
  }

  publishRelayRealtimeEvent(event);
}

export function broadcastWorkspaceUpdated(details: {
  projectId?: number | null;
  threadId?: number | null;
} = {}): void {
  broadcastRealtimeEvent({
    type: "workspace-updated",
    projectId: details.projectId ?? null,
    threadId: details.threadId ?? null,
  });
}

export function broadcastThreadMessagesUpdated(threadId: number): void {
  broadcastRealtimeEvent({
    type: "thread-messages-updated",
    threadId,
  });
}

export function broadcastThreadState(threadId: number, projectId?: number | null): void {
  broadcastThreadMessagesUpdated(threadId);
  broadcastWorkspaceUpdated({
    threadId,
    projectId: projectId ?? null,
  });
}

export function broadcastThreadTurnState(threadId: number): void {
  const state = getThreadQueueSnapshot(threadId);
  broadcastRealtimeEvent({
    type: "thread-turn-state",
    threadId,
    running: state.running,
    queueDepth: state.queueDepth,
    mode: state.mode,
  });
}

export function broadcastThreadStreamEvent(threadId: number, event: ThreadStreamRealtimeEvent): void {
  const nextSnapshot = applyThreadStreamEventToSnapshot(threadLiveSnapshots.get(threadId), event);
  if (nextSnapshot) {
    threadLiveSnapshots.set(threadId, nextSnapshot);
  } else {
    threadLiveSnapshots.delete(threadId);
  }

  broadcastRealtimeEvent({
    type: "thread-stream-event",
    threadId,
    event,
  });
}

function updateThreadQueueState(
  threadId: number,
  updater: (current: ThreadQueueState) => ThreadQueueState,
): ThreadQueueState {
  const current = threadQueueStates.get(threadId) || {
    tail: Promise.resolve(),
    queueDepth: 0,
    running: false,
    mode: null,
  };
  const next = updater(current);
  threadQueueStates.set(threadId, next);
  broadcastThreadTurnState(threadId);
  broadcastWorkspaceUpdated({
    threadId,
  });
  return next;
}

export async function enqueueThreadTask<T>(
  threadId: number,
  mode: "default" | "plan",
  task: () => Promise<T>,
): Promise<T> {
  const current = threadQueueStates.get(threadId) || {
    tail: Promise.resolve(),
    queueDepth: 0,
    running: false,
    mode: null,
  };
  const queuedDepth = current.queueDepth + 1;
  threadQueueStates.set(threadId, {
    ...current,
    queueDepth: queuedDepth,
  });
  broadcastThreadTurnState(threadId);
  broadcastWorkspaceUpdated({
    threadId,
  });

  const execute = async (): Promise<T> => {
    updateThreadQueueState(threadId, (state) => ({
      ...state,
      queueDepth: Math.max(state.queueDepth - 1, 0),
      running: true,
      mode,
    }));

    try {
      return await task();
    } finally {
      updateThreadQueueState(threadId, (state) => ({
        ...state,
        running: false,
        mode: null,
      }));
      broadcastThreadStreamEvent(threadId, {
        type: "clear",
      });
    }
  };

  const nextPromise = current.tail.then(execute, execute);
  threadQueueStates.set(threadId, {
    tail: nextPromise.then(
      () => undefined,
      () => undefined,
    ),
    queueDepth: queuedDepth,
    running: current.running,
    mode: current.mode,
  });

  return nextPromise;
}

export function attachRealtimeServer(server: HttpServer): WebSocketServer {
  const wsServer = new WebSocketServer({
    server,
    path: "/ws",
  });

  wsServer.on("connection", (socket) => {
    websocketClients.add(socket);
    const connectedEvent: RealtimeEvent = { type: "connected" };
    socket.send(JSON.stringify(connectedEvent));

    socket.on("close", () => {
      websocketClients.delete(socket);
    });

    socket.on("error", () => {
      websocketClients.delete(socket);
    });
  });

  return wsServer;
}
