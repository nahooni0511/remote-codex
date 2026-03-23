import test from "node:test";
import assert from "node:assert/strict";

import type { MessageRecord, ThreadStreamRealtimeEvent } from "@remote-codex/contracts";

import {
  applyThreadStreamEvent,
  mergeThreadMessages,
  shouldClearLiveStreamForMessages,
} from "./chat";

function createMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 1,
    threadId: 1,
    kind: "assistant_message",
    role: "assistant",
    content: "hello",
    originChannel: "local-ui",
    originActor: "Codex",
    displayHints: {
      hideOrigin: false,
      accent: "default",
      localSenderName: "Codex",
      telegramSenderName: null,
    },
    errorText: null,
    attachmentKind: null,
    attachmentMimeType: null,
    attachmentFilename: null,
    payload: null,
    createdAt: "2026-03-22T00:00:00.000Z",
    ...overrides,
  };
}

test("mergeThreadMessages deduplicates by id and keeps chronological order", () => {
  const existing = [createMessage({ id: 2, content: "second" }), createMessage({ id: 4, content: "fourth" })];
  const incoming = [createMessage({ id: 1, content: "first" }), createMessage({ id: 4, content: "updated fourth" })];

  const merged = mergeThreadMessages(existing, incoming, "prepend");

  assert.deepEqual(
    merged.map((message) => [message.id, message.content]),
    [
      [1, "first"],
      [2, "second"],
      [4, "fourth"],
    ],
  );
});

test("applyThreadStreamEvent accumulates deltas and clears state", () => {
  const deltaEvent: ThreadStreamRealtimeEvent = { type: "assistant-delta", text: "Hello" };
  const completeEvent: ThreadStreamRealtimeEvent = { type: "assistant-delta", text: " world" };
  const clearEvent: ThreadStreamRealtimeEvent = { type: "clear" };

  const accumulated = applyThreadStreamEvent(applyThreadStreamEvent(null, deltaEvent), completeEvent);
  assert.deepEqual(accumulated, {
    reasoningText: "",
    assistantText: "Hello world",
    planText: "",
  });

  assert.equal(applyThreadStreamEvent(accumulated, clearEvent), null);
});

test("shouldClearLiveStreamForMessages follows terminal assistant messages and summaries", () => {
  assert.equal(shouldClearLiveStreamForMessages([], false), false);
  assert.equal(shouldClearLiveStreamForMessages([createMessage({ role: "assistant" })], true), true);
  assert.equal(
    shouldClearLiveStreamForMessages(
      [
        createMessage({
          role: "system",
          payload: {
            kind: "turn_summary",
            summary: {
              turnRunId: 10,
              durationMs: 2000,
              changedFileCount: 0,
              changedFiles: [],
              exploredFilesCount: 1,
              undoAvailable: false,
              undoState: "not_available",
              branch: null,
              repoCleanAtStart: true,
              note: null,
            },
          },
        }),
      ],
      true,
    ),
    true,
  );
  assert.equal(shouldClearLiveStreamForMessages([createMessage({ role: "user" })], false), true);
});
