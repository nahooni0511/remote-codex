import type { ConnectionRow, MessageRow } from "../db";
import {
  createMessageEvent,
  db,
  ensureTelegramProjectBindingRow,
  getDeviceProfile,
  resolveDisplayHints,
  resolveEventKind,
  resolveOriginChannel,
} from "../db";

function ensureConnectionBindingsFromLegacy(): void {
  const rows = db.prepare("SELECT * FROM project_telegram_connections").all() as ConnectionRow[];
  for (const row of rows) {
    ensureTelegramProjectBindingRow(row.project_id);
    db.prepare(
      `
        UPDATE telegram_project_bindings
        SET
          telegram_chat_id = ?,
          telegram_access_hash = ?,
          telegram_chat_title = ?,
          forum_enabled = ?,
          updated_at = ?
        WHERE project_id = ?
      `,
    ).run(
      row.telegram_chat_id,
      row.telegram_access_hash,
      row.telegram_chat_title,
      row.forum_enabled,
      row.updated_at,
      row.project_id,
    );
  }
}

function ensureThreadBindingsFromLegacy(): void {
  const rows = db
    .prepare("SELECT id, telegram_topic_id, telegram_topic_name, created_at, updated_at FROM threads WHERE telegram_topic_id > 0")
    .all() as Array<{
    id: number;
    telegram_topic_id: number;
    telegram_topic_name: string | null;
    created_at: string;
    updated_at: string;
  }>;
  for (const row of rows) {
    db.prepare(
      `
        INSERT INTO telegram_thread_bindings (
          thread_id,
          telegram_topic_id,
          telegram_topic_name,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(thread_id)
        DO UPDATE SET
          telegram_topic_id = excluded.telegram_topic_id,
          telegram_topic_name = excluded.telegram_topic_name,
          updated_at = excluded.updated_at
      `,
    ).run(row.id, row.telegram_topic_id, row.telegram_topic_name, row.created_at, row.updated_at);
  }
}

function ensureMessageEventsFromLegacy(): void {
  const rows = db.prepare("SELECT * FROM messages ORDER BY id ASC").all() as MessageRow[];
  for (const row of rows) {
    const existing = db
      .prepare("SELECT id FROM message_events WHERE legacy_message_id = ?")
      .get(row.id) as { id: number } | undefined;
    if (existing) {
      continue;
    }

    createMessageEvent({
      threadId: row.thread_id,
      kind: resolveEventKind({
        role: row.role,
        source: row.source,
        content: row.content,
        errorText: row.error_text,
        attachmentKind: row.attachment_kind,
      }),
      role: row.role,
      content: row.content,
      originChannel: resolveOriginChannel(row.source),
      originActor: row.sender_name,
      displayHints: resolveDisplayHints({
        source: row.source,
        role: row.role,
        senderName: row.sender_name,
        errorText: row.error_text,
      }),
      errorText: row.error_text,
      attachmentKind: row.attachment_kind,
      attachmentPath: row.attachment_path,
      attachmentMimeType: row.attachment_mime_type,
      attachmentFilename: row.attachment_filename,
      createdAt: row.created_at,
      legacyMessageId: row.id,
      telegramMessageId: row.telegram_message_id,
    });
  }
}

export function syncCanonicalTablesFromLegacy(): void {
  getDeviceProfile();
  ensureConnectionBindingsFromLegacy();
  ensureThreadBindingsFromLegacy();
  ensureMessageEventsFromLegacy();
}
