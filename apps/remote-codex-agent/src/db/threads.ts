import type {
  ChannelKind,
  CodexPermissionMode,
  DeliveryStatus,
  MessageDisplayHints,
  MessageEventKind,
  MessageEventPayload,
  ThreadMode,
  TurnSummaryPayload,
  TurnUndoState,
} from "@remote-codex/contracts";

import type {
  CodexTurnRunRecord,
  CodexTurnRunRow,
  ListMessagesByThreadOptions,
  ListMessagesByThreadResult,
  MessageAttachmentRecord,
  MessageEventDeliveryRecord,
  MessageEventDeliveryRow,
  MessageEventRecord,
  MessageEventRow,
  MessageRecord,
  MessageRow,
  TelegramThreadBindingRow,
  ThreadRecord,
  ThreadRow,
} from "./types";
import { db, nowIso } from "./core";
import {
  mapCodexTurnRun,
  mapMessage,
  mapMessageEvent,
  mapMessageEventDelivery,
  mapThread,
  resolveDisplayHints,
  resolveEventKind,
  resolveOriginChannel,
  saveTelegramThreadBinding,
} from "./mappers";
import { getTelegramAuth } from "./settings";

export function createMessageEvent(input: {
  threadId: number;
  kind: MessageEventKind;
  role: string;
  content: string;
  originChannel: ChannelKind;
  originActor?: string | null;
  displayHints: MessageDisplayHints;
  errorText?: string | null;
  attachmentKind?: string | null;
  attachmentPath?: string | null;
  attachmentMimeType?: string | null;
  attachmentFilename?: string | null;
  payload?: MessageEventPayload;
  createdAt?: string;
  legacyMessageId?: number | null;
  telegramMessageId?: number | null;
}): MessageEventRecord {
  const timestamp = input.createdAt || nowIso();
  const result = db.prepare(
    `
      INSERT INTO message_events (
        legacy_message_id,
        thread_id,
        kind,
        role,
        content,
        origin_channel,
        origin_actor,
        display_hints_json,
        error_text,
        attachment_kind,
        attachment_path,
        attachment_mime_type,
        attachment_filename,
        payload_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.legacyMessageId ?? null,
    input.threadId,
    input.kind,
    input.role,
    input.content,
    input.originChannel,
    input.originActor ?? null,
    JSON.stringify(input.displayHints),
    input.errorText ?? null,
    input.attachmentKind ?? null,
    input.attachmentPath ?? null,
    input.attachmentMimeType ?? null,
    input.attachmentFilename ?? null,
    input.payload ? JSON.stringify(input.payload) : null,
    timestamp,
    timestamp,
  );

  const eventId = Number(result.lastInsertRowid);
  createMessageEventDelivery({
    eventId,
    channel: "local-ui",
    status: "delivered",
    detail: "Canonical local store",
    createdAt: timestamp,
  });
  createMessageEventDelivery({
    eventId,
    channel: "global-ui",
    status: "delivered",
    detail: "Canonical relay store",
    createdAt: timestamp,
  });
  createMessageEventDelivery({
    eventId,
    channel: "telegram",
    status: input.telegramMessageId ? "delivered" : getTelegramAuth().isAuthenticated ? "skipped" : "skipped",
    detail: input.telegramMessageId ? `telegram:${input.telegramMessageId}` : "Telegram mirror not attempted",
    createdAt: timestamp,
  });

  if (input.telegramMessageId) {
    db.prepare(
      `
        INSERT OR IGNORE INTO telegram_message_refs (event_id, thread_id, telegram_message_id, created_at)
        VALUES (?, ?, ?, ?)
      `,
    ).run(eventId, input.threadId, input.telegramMessageId, timestamp);
  }

  const row = db.prepare("SELECT * FROM message_events WHERE id = ?").get(eventId) as MessageEventRow;
  return mapMessageEvent(row);
}

export function createMessageEventDelivery(input: {
  eventId: number;
  channel: ChannelKind;
  status: DeliveryStatus;
  detail?: string | null;
  createdAt?: string;
}): MessageEventDeliveryRecord {
  const timestamp = input.createdAt || nowIso();
  const result = db.prepare(
    `
      INSERT INTO message_event_deliveries (
        event_id,
        channel,
        status,
        detail,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(input.eventId, input.channel, input.status, input.detail ?? null, timestamp, timestamp);

  const row = db.prepare("SELECT * FROM message_event_deliveries WHERE id = ?").get(Number(result.lastInsertRowid)) as
    | MessageEventDeliveryRow
    | undefined;
  return mapMessageEventDelivery(row!);
}

export function listMessageEventDeliveries(eventId: number): MessageEventDeliveryRecord[] {
  const rows = db
    .prepare("SELECT * FROM message_event_deliveries WHERE event_id = ? ORDER BY id ASC")
    .all(eventId) as MessageEventDeliveryRow[];
  return rows.map(mapMessageEventDelivery);
}

export function updateLatestMessageEventDelivery(
  eventId: number,
  channel: ChannelKind,
  status: DeliveryStatus,
  detail?: string | null,
): MessageEventDeliveryRecord | null {
  const existing = db
    .prepare("SELECT * FROM message_event_deliveries WHERE event_id = ? AND channel = ? ORDER BY id DESC LIMIT 1")
    .get(eventId, channel) as MessageEventDeliveryRow | undefined;
  if (!existing) {
    return createMessageEventDelivery({ eventId, channel, status, detail: detail ?? null });
  }

  const timestamp = nowIso();
  db.prepare(
    `
      UPDATE message_event_deliveries
      SET status = ?, detail = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(status, detail ?? existing.detail, timestamp, existing.id);

  const row = db.prepare("SELECT * FROM message_event_deliveries WHERE id = ?").get(existing.id) as
    | MessageEventDeliveryRow
    | undefined;
  return row ? mapMessageEventDelivery(row) : null;
}

export function updateMessageEventPayload(eventId: number, payload: MessageEventPayload): MessageEventRecord | null {
  const timestamp = nowIso();
  const result = db.prepare(
    `
      UPDATE message_events
      SET payload_json = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(payload ? JSON.stringify(payload) : null, timestamp, eventId);

  if (result.changes === 0) {
    return null;
  }

  const row = db.prepare("SELECT * FROM message_events WHERE id = ?").get(eventId) as MessageEventRow | undefined;
  return row ? mapMessageEvent(row) : null;
}

export function createCodexTurnRun(input: {
  threadId: number;
  mode: ThreadMode;
  modelId: string;
  reasoningEffort?: string | null;
  permissionMode: CodexPermissionMode;
  startedAt?: string;
  branchAtStart?: string | null;
  repoCleanAtStart: boolean;
}): CodexTurnRunRecord {
  const timestamp = input.startedAt || nowIso();
  const undoState = input.repoCleanAtStart ? "available" : "not_available";
  const result = db.prepare(
    `
      INSERT INTO codex_turn_runs (
        thread_id,
        mode,
        model_id,
        reasoning_effort,
        permission_mode,
        started_at,
        completed_at,
        duration_ms,
        branch_at_start,
        branch_at_end,
        repo_clean_at_start,
        undo_state,
        explored_files_count,
        changed_files_json,
        repo_status_after,
        summary_event_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
    `,
  ).run(
    input.threadId,
    input.mode === "plan" ? "plan" : "default",
    input.modelId,
    input.reasoningEffort ?? null,
    input.permissionMode === "danger-full-access" ? "danger-full-access" : "default",
    timestamp,
    input.branchAtStart ?? null,
    input.repoCleanAtStart ? 1 : 0,
    undoState,
    timestamp,
    timestamp,
  );

  const row = db.prepare("SELECT * FROM codex_turn_runs WHERE id = ?").get(Number(result.lastInsertRowid)) as
    | CodexTurnRunRow
    | undefined;
  if (!row) {
    throw new Error("Failed to create Codex turn run.");
  }
  return mapCodexTurnRun(row);
}

export function completeCodexTurnRun(
  turnRunId: number,
  input: {
    completedAt?: string;
    durationMs: number;
    branchAtEnd?: string | null;
    undoState: TurnUndoState;
    exploredFilesCount?: number | null;
    changedFiles: TurnSummaryPayload["changedFiles"];
    repoStatusAfter?: string | null;
    summaryEventId?: number | null;
  },
): CodexTurnRunRecord | null {
  const timestamp = input.completedAt || nowIso();
  const changedFilesJson = input.changedFiles.length ? JSON.stringify(input.changedFiles) : "[]";
  const result = db.prepare(
    `
      UPDATE codex_turn_runs
      SET
        completed_at = ?,
        duration_ms = ?,
        branch_at_end = ?,
        undo_state = ?,
        explored_files_count = ?,
        changed_files_json = ?,
        repo_status_after = ?,
        summary_event_id = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    timestamp,
    input.durationMs,
    input.branchAtEnd ?? null,
    input.undoState,
    input.exploredFilesCount ?? null,
    changedFilesJson,
    input.repoStatusAfter ?? null,
    input.summaryEventId ?? null,
    timestamp,
    turnRunId,
  );

  if (result.changes === 0) {
    return null;
  }

  const row = db.prepare("SELECT * FROM codex_turn_runs WHERE id = ?").get(turnRunId) as CodexTurnRunRow | undefined;
  return row ? mapCodexTurnRun(row) : null;
}

export function getCodexTurnRunById(turnRunId: number): CodexTurnRunRecord | null {
  const row = db.prepare("SELECT * FROM codex_turn_runs WHERE id = ?").get(turnRunId) as CodexTurnRunRow | undefined;
  return row ? mapCodexTurnRun(row) : null;
}

export function getLatestCodexTurnRunForThread(threadId: number): CodexTurnRunRecord | null {
  const row = db
    .prepare("SELECT * FROM codex_turn_runs WHERE thread_id = ? ORDER BY id DESC LIMIT 1")
    .get(threadId) as CodexTurnRunRow | undefined;
  return row ? mapCodexTurnRun(row) : null;
}

export function markCodexTurnRunUndone(turnRunId: number): CodexTurnRunRecord | null {
  const timestamp = nowIso();
  const result = db.prepare(
    `
      UPDATE codex_turn_runs
      SET undo_state = 'undone', updated_at = ?
      WHERE id = ?
    `,
  ).run(timestamp, turnRunId);

  if (result.changes === 0) {
    return null;
  }

  const row = db.prepare("SELECT * FROM codex_turn_runs WHERE id = ?").get(turnRunId) as CodexTurnRunRow | undefined;
  return row ? mapCodexTurnRun(row) : null;
}

export function createThread(input: {
  projectId: number;
  title: string;
  telegramTopicId?: number | null;
  telegramTopicName?: string | null;
  codexThreadId?: string | null;
  codexModelOverride?: string | null;
  codexReasoningEffortOverride?: string | null;
  defaultMode?: ThreadMode;
  codexPermissionMode?: CodexPermissionMode;
  origin?: string;
  status?: string;
}): ThreadRecord {
  const timestamp = nowIso();
  const telegramTopicId =
    typeof input.telegramTopicId === "number" && Number.isInteger(input.telegramTopicId) && input.telegramTopicId > 0
      ? input.telegramTopicId
      : -Math.floor(Date.now() * 1000 + Math.random() * 1000);
  const result = db
    .prepare(
      `
        INSERT INTO threads (
          project_id,
          title,
          telegram_topic_id,
          telegram_topic_name,
          codex_thread_id,
          codex_model_override,
          codex_reasoning_effort_override,
          default_mode,
          codex_permission_mode,
          origin,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.projectId,
      input.title,
      telegramTopicId,
      input.telegramTopicName ?? null,
      input.codexThreadId ?? null,
      input.codexModelOverride ?? null,
      input.codexReasoningEffortOverride ?? null,
      input.defaultMode === "plan" ? "plan" : "default",
      input.codexPermissionMode === "danger-full-access" ? "danger-full-access" : "default",
      input.origin ?? "app",
      input.status ?? "open",
      timestamp,
      timestamp,
    );

  const threadId = Number(result.lastInsertRowid);
  if (telegramTopicId > 0) {
    saveTelegramThreadBinding(threadId, telegramTopicId, input.telegramTopicName ?? input.title);
  }
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, input.projectId);
  return getThreadById(threadId)!;
}

export function getThreadById(threadId: number): ThreadRecord | null {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  const binding = db.prepare("SELECT * FROM telegram_thread_bindings WHERE thread_id = ?").get(threadId) as
    | TelegramThreadBindingRow
    | undefined;
  return row ? mapThread(row, binding) : null;
}

export function getThreadByProjectAndTelegramTopic(projectId: number, telegramTopicId: number): ThreadRecord | null {
  const binding = db
    .prepare(
      `
        SELECT ttb.*
        FROM telegram_thread_bindings ttb
        INNER JOIN threads t ON t.id = ttb.thread_id
        WHERE t.project_id = ? AND ttb.telegram_topic_id = ?
      `,
    )
    .get(projectId, telegramTopicId) as TelegramThreadBindingRow | undefined;
  if (binding) {
    return getThreadById(binding.thread_id);
  }
  const row = db
    .prepare("SELECT * FROM threads WHERE project_id = ? AND telegram_topic_id = ?")
    .get(projectId, telegramTopicId) as ThreadRow | undefined;
  return row ? mapThread(row) : null;
}

export function updateThreadCodexThreadId(threadId: number, codexThreadId: string): ThreadRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare("UPDATE threads SET codex_thread_id = ?, updated_at = ? WHERE id = ?")
    .run(codexThreadId, timestamp, threadId);

  if (result.changes === 0) {
    return null;
  }

  return getThreadById(threadId);
}

export function updateThreadCodexOverrides(
  threadId: number,
  input: {
    codexModelOverride?: string | null;
    codexReasoningEffortOverride?: string | null;
    defaultMode?: ThreadMode;
    codexPermissionMode?: CodexPermissionMode;
  },
): ThreadRecord | null {
  const existing = getThreadById(threadId);
  if (!existing) {
    return null;
  }

  const timestamp = nowIso();
  const nextModelOverride =
    input.codexModelOverride === undefined
      ? existing.codexModelOverride
      : input.codexModelOverride?.trim() || null;
  const nextReasoningEffortOverride =
    input.codexReasoningEffortOverride === undefined
      ? existing.codexReasoningEffortOverride
      : input.codexReasoningEffortOverride?.trim() || null;
  const nextDefaultMode =
    input.defaultMode === undefined ? existing.defaultMode : input.defaultMode === "plan" ? "plan" : "default";
  const nextPermissionMode =
    input.codexPermissionMode === undefined
      ? existing.codexPermissionMode
      : input.codexPermissionMode === "danger-full-access"
        ? "danger-full-access"
        : "default";

  db.prepare(
    `
      UPDATE threads
      SET
        codex_model_override = ?,
        codex_reasoning_effort_override = ?,
        default_mode = ?,
        codex_permission_mode = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    nextModelOverride,
    nextReasoningEffortOverride,
    nextDefaultMode,
    nextPermissionMode,
    timestamp,
    threadId,
  );

  return getThreadById(threadId);
}

export function updateThreadTopicMetadata(
  threadId: number,
  input: { title?: string; telegramTopicName?: string | null },
): ThreadRecord | null {
  const existing = getThreadById(threadId);
  if (!existing) {
    return null;
  }

  const nextTitle = input.title?.trim() || existing.title;
  const nextTopicName = input.telegramTopicName ?? existing.telegramTopicName ?? existing.title;
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE threads
      SET title = ?, telegram_topic_name = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(nextTitle, nextTopicName, timestamp, threadId);
  if (existing.telegramTopicId > 0) {
    saveTelegramThreadBinding(threadId, existing.telegramTopicId, nextTopicName);
  }

  return getThreadById(threadId);
}

export function deleteThread(threadId: number): boolean {
  const thread = getThreadById(threadId);
  if (!thread) {
    return false;
  }

  const result = db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  if (result.changes === 0) {
    return false;
  }

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), thread.projectId);
  return true;
}

export function findMessageByTelegramMessageId(threadId: number, telegramMessageId: number): MessageRecord | null {
  const eventRef = db
    .prepare(
      `
        SELECT me.*
        FROM telegram_message_refs tmr
        INNER JOIN message_events me ON me.id = tmr.event_id
        WHERE tmr.thread_id = ? AND tmr.telegram_message_id = ?
      `,
    )
    .get(threadId, telegramMessageId) as MessageEventRow | undefined;
  if (eventRef) {
    return {
      id: eventRef.id,
      threadId: eventRef.thread_id,
      role: eventRef.role,
      content: eventRef.content,
      source: eventRef.origin_channel,
      senderName: eventRef.origin_actor,
      senderTelegramUserId: null,
      telegramMessageId,
      errorText: eventRef.error_text,
      attachmentKind: eventRef.attachment_kind,
      attachmentMimeType: eventRef.attachment_mime_type,
      attachmentFilename: eventRef.attachment_filename,
      createdAt: eventRef.created_at,
    };
  }

  const row = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? AND telegram_message_id = ?")
    .get(threadId, telegramMessageId) as MessageRow | undefined;

  return row ? mapMessage(row) : null;
}

export function getMessageAttachmentById(messageId: number): MessageAttachmentRecord | null {
  const eventRow = db
    .prepare(
      `
        SELECT id, attachment_kind, attachment_path, attachment_mime_type, attachment_filename
        FROM message_events
        WHERE id = ?
      `,
    )
    .get(messageId) as
    | {
        id: number;
        attachment_kind: string | null;
        attachment_path: string | null;
        attachment_mime_type: string | null;
        attachment_filename: string | null;
      }
    | undefined;
  if (eventRow?.attachment_kind && eventRow.attachment_path) {
    return {
      messageId: eventRow.id,
      kind: eventRow.attachment_kind,
      path: eventRow.attachment_path,
      mimeType: eventRow.attachment_mime_type,
      filename: eventRow.attachment_filename,
    };
  }

  const row = db
    .prepare(
      `
        SELECT id, attachment_kind, attachment_path, attachment_mime_type, attachment_filename
        FROM messages
        WHERE id = ?
      `,
    )
    .get(messageId) as
    | {
        id: number;
        attachment_kind: string | null;
        attachment_path: string | null;
        attachment_mime_type: string | null;
        attachment_filename: string | null;
      }
    | undefined;

  if (!row?.attachment_kind || !row.attachment_path) {
    return null;
  }

  return {
    messageId: row.id,
    kind: row.attachment_kind,
    path: row.attachment_path,
    mimeType: row.attachment_mime_type,
    filename: row.attachment_filename,
  };
}

export function createMessage(input: {
  threadId: number;
  role: string;
  content: string;
  source?: string;
  senderName?: string | null;
  senderTelegramUserId?: string | null;
  telegramMessageId?: number | null;
  errorText?: string | null;
  attachmentKind?: string | null;
  attachmentPath?: string | null;
  attachmentMimeType?: string | null;
  attachmentFilename?: string | null;
  payload?: MessageEventPayload;
}): MessageRecord {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        INSERT INTO messages (
          thread_id,
          role,
          content,
          source,
          sender_name,
          sender_telegram_user_id,
          telegram_message_id,
          error_text,
          attachment_kind,
          attachment_path,
          attachment_mime_type,
          attachment_filename,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.threadId,
      input.role,
      input.content,
      input.source ?? "web",
      input.senderName ?? null,
      input.senderTelegramUserId ?? null,
      input.telegramMessageId ?? null,
      input.errorText ?? null,
      input.attachmentKind ?? null,
      input.attachmentPath ?? null,
      input.attachmentMimeType ?? null,
      input.attachmentFilename ?? null,
      timestamp,
    );

  const thread = getThreadById(input.threadId);
  if (thread) {
    db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(timestamp, thread.id);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, thread.projectId);
  }

  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid)) as MessageRow;
  createMessageEvent({
    threadId: input.threadId,
    kind: resolveEventKind({
      role: input.role,
      source: input.source ?? "web",
      content: input.content,
      errorText: input.errorText,
      attachmentKind: input.attachmentKind,
    }),
    role: input.role,
    content: input.content,
    originChannel: resolveOriginChannel(input.source ?? "web"),
    originActor: input.senderName ?? null,
    displayHints: resolveDisplayHints({
      source: input.source ?? "web",
      role: input.role,
      senderName: input.senderName,
      errorText: input.errorText,
    }),
    errorText: input.errorText ?? null,
    attachmentKind: input.attachmentKind ?? null,
    attachmentPath: input.attachmentPath ?? null,
    attachmentMimeType: input.attachmentMimeType ?? null,
    attachmentFilename: input.attachmentFilename ?? null,
    payload: input.payload ?? null,
    createdAt: timestamp,
    legacyMessageId: Number(result.lastInsertRowid),
    telegramMessageId: input.telegramMessageId ?? null,
  });
  return mapMessage(row);
}

export function listMessagesByThread(
  threadId: number,
  options: ListMessagesByThreadOptions = {},
): ListMessagesByThreadResult {
  const limit = Number.isInteger(options.limit) && options.limit && options.limit > 0 ? options.limit : null;
  const beforeMessageId =
    Number.isInteger(options.beforeMessageId) && Number(options.beforeMessageId) > 0 ? Number(options.beforeMessageId) : null;
  const afterMessageId =
    Number.isInteger(options.afterMessageId) && Number(options.afterMessageId) > 0 ? Number(options.afterMessageId) : null;

  if (beforeMessageId && afterMessageId) {
    throw new Error("beforeMessageId and afterMessageId cannot be combined.");
  }

  if (afterMessageId) {
    const rows = db
      .prepare("SELECT * FROM message_events WHERE thread_id = ? AND id > ? ORDER BY created_at ASC, id ASC")
      .all(threadId, afterMessageId) as MessageRow[];

    return {
      messages: (rows as unknown as MessageEventRow[]).map(mapMessageEvent) as unknown as MessageRecord[],
      hasMoreBefore: db
        .prepare("SELECT 1 FROM message_events WHERE thread_id = ? AND id <= ? LIMIT 1")
        .get(threadId, afterMessageId)
        ? true
        : false,
    };
  }

  if (!limit) {
    const rows = db
      .prepare("SELECT * FROM message_events WHERE thread_id = ? ORDER BY created_at ASC, id ASC")
      .all(threadId) as MessageEventRow[];

    return {
      messages: rows.map(mapMessageEvent) as unknown as MessageRecord[],
      hasMoreBefore: false,
    };
  }

  const query = beforeMessageId
    ? "SELECT * FROM message_events WHERE thread_id = ? AND id < ? ORDER BY created_at DESC, id DESC LIMIT ?"
    : "SELECT * FROM message_events WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
  const params = beforeMessageId ? [threadId, beforeMessageId, limit + 1] : [threadId, limit + 1];
  const rows = db.prepare(query).all(...params) as MessageEventRow[];
  const hasMoreBefore = rows.length > limit;
  const windowRows = (hasMoreBefore ? rows.slice(0, limit) : rows).reverse();

  return {
    messages: windowRows.map(mapMessageEvent) as unknown as MessageRecord[],
    hasMoreBefore,
  };
}
