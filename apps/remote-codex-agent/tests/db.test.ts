import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";

test("createMessage mirrors canonical message events", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "remote-codex-db-"));
  process.env.DATABASE_PATH = path.join(tempDir, "app.db");

  const dbModule = await import(`../src/db.ts?db-test=${Date.now()}`);
  const project = dbModule.createProject({
    name: "Test Project",
    folderPath: tempDir,
  });
  const thread = dbModule.createThread({
    projectId: project.id,
    title: "Thread A",
  });

  dbModule.createMessage({
    threadId: thread.id,
    role: "user",
    content: "hello canonical store",
    source: "local-ui",
    senderName: "Local User",
  });

  const result = dbModule.listMessagesByThread(thread.id);
  assert.equal(result.messages.length, 1);
  assert.equal((result.messages[0] as unknown as { originChannel?: string }).originChannel, "local-ui");
  assert.equal((result.messages[0] as unknown as { content: string }).content, "hello canonical store");
});

test("codex turn run helpers persist summary metadata", { concurrency: false }, async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "remote-codex-db-"));
  process.env.DATABASE_PATH = path.join(tempDir, "app.db");

  const dbModule = await import(`../src/db.ts?turn-run-test=${Date.now()}`);
  const project = dbModule.createProject({
    name: "Git Project",
    folderPath: tempDir,
  });
  const thread = dbModule.createThread({
    projectId: project.id,
    title: "Thread B",
  });

  const turnRun = dbModule.createCodexTurnRun({
    threadId: thread.id,
    mode: "default",
    modelId: "gpt-5.4",
    reasoningEffort: "high",
    permissionMode: "default",
    branchAtStart: "main",
    repoCleanAtStart: true,
  });
  const summaryEvent = dbModule.createMessageEvent({
    threadId: thread.id,
    kind: "turn_summary_event",
    role: "system",
    content: "1개 파일 변경됨",
    originChannel: "local-ui",
    displayHints: {
      hideOrigin: true,
      accent: "default",
      localSenderName: "Codex",
      telegramSenderName: "Codex",
    },
    payload: {
      kind: "turn_summary",
      summary: {
        turnRunId: turnRun.id,
        durationMs: 2400,
        changedFileCount: 1,
        changedFiles: [
          {
            path: "src/index.ts",
            status: "M",
            insertions: 10,
            deletions: 2,
            isUntracked: false,
            statsExact: true,
          },
        ],
        exploredFilesCount: 3,
        undoAvailable: true,
        undoState: "available",
        branch: "main",
        repoCleanAtStart: true,
        note: null,
      },
    },
  });

  const completedTurn = dbModule.completeCodexTurnRun(turnRun.id, {
    durationMs: 2400,
    branchAtEnd: "main",
    undoState: "available",
    exploredFilesCount: 3,
    changedFiles: [
      {
        path: "src/index.ts",
        status: "M",
        insertions: 10,
        deletions: 2,
        isUntracked: false,
        statsExact: true,
      },
    ],
    repoStatusAfter: " M src/index.ts",
    summaryEventId: summaryEvent.id,
  });

  assert.ok(completedTurn);
  assert.equal(completedTurn?.summaryEventId, summaryEvent.id);
  assert.equal(completedTurn?.changedFiles.length, 1);
  assert.equal(dbModule.getLatestCodexTurnRunForThread(thread.id)?.id, turnRun.id);

  const updatedSummary = dbModule.updateMessageEventPayload(summaryEvent.id, {
    kind: "turn_summary",
    summary: {
      turnRunId: turnRun.id,
      durationMs: 2400,
      changedFileCount: 1,
      changedFiles: completedTurn?.changedFiles || [],
      exploredFilesCount: 3,
      undoAvailable: false,
      undoState: "undone",
      branch: "main",
      repoCleanAtStart: true,
      note: "실행취소됨",
    },
  });
  assert.equal(updatedSummary?.payload?.kind, "turn_summary");

  const undoneTurn = dbModule.markCodexTurnRunUndone(turnRun.id);
  assert.equal(undoneTurn?.undoState, "undone");
});
