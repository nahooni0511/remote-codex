import type {
  MessageRecord,
  ThreadMode,
} from "@remote-codex/contracts";
import {
  applyThreadStreamEvent,
  shouldClearLiveStreamForMessages,
  type LiveStreamState,
} from "@remote-codex/workspace-core";

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

export { applyThreadStreamEvent, shouldClearLiveStreamForMessages };
