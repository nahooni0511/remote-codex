import type {
  MessageRecord,
  ThreadMode,
  ThreadStreamRealtimeEvent,
} from "@remote-codex/contracts";

import type { LiveStreamState } from "../lib/chat";

export type ThreadCacheEntry = {
  thread: {
    id: number;
    title: string;
  } | null;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
};

export type ThreadRuntimeState = {
  running: boolean;
  queueDepth: number;
  mode: ThreadMode;
};

export function pruneByThreadIds<T>(value: Record<number, T>, allowedThreadIds: Set<number>): Record<number, T> {
  return Object.fromEntries(
    Object.entries(value).filter(([threadId]) => allowedThreadIds.has(Number(threadId))),
  ) as Record<number, T>;
}

export function buildThreadMessagesUrl(
  threadId: number,
  options: { limit?: number; before?: number | null; after?: number | null },
) {
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

export function applyThreadStreamEvent(
  current: LiveStreamState | undefined,
  event: ThreadStreamRealtimeEvent,
): LiveStreamState | null {
  if (event.type === "clear") {
    return null;
  }

  const next: LiveStreamState = current
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
    const lines: string[] = [];
    if (event.explanation) {
      lines.push(event.explanation);
    }
    if (Array.isArray(event.plan) && event.plan.length) {
      if (lines.length) {
        lines.push("");
      }
      event.plan.forEach((step) => {
        lines.push(`- [${step.status}] ${step.step}`);
      });
    }
    next.planText = lines.join("\n").trim();
  }

  return next.reasoningText || next.assistantText || next.planText ? next : null;
}

export function shouldClearLiveStreamForMessages(messages: MessageRecord[], running: boolean): boolean {
  if (!running && messages.length > 0) {
    return true;
  }

  return messages.some(
    (message) =>
      message.role === "assistant" ||
      message.payload?.kind === "turn_summary" ||
      message.payload?.kind === "user_input_request",
  );
}
