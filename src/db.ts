import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_DATABASE_PATH = "./data/app.db";

export interface ConnectionRecord {
  id: number;
  projectId: number;
  telegramChatId: string | null;
  telegramChatTitle: string | null;
  forumEnabled: boolean;
  botJoined: boolean;
  botIsAdmin: boolean;
  canManageTopics: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  connection: ConnectionRecord | null;
}

export interface ThreadRecord {
  id: number;
  projectId: number;
  title: string;
  telegramTopicId: number;
  telegramTopicName: string | null;
  codexSessionId: string | null;
  origin: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: number;
  threadId: number;
  role: string;
  content: string;
  source: string;
  senderName: string | null;
  senderTelegramUserId: string | null;
  telegramMessageId: number | null;
  errorText: string | null;
  createdAt: string;
}

export interface ProjectTreeRecord extends ProjectRecord {
  threads: ThreadRecord[];
}

type ProjectRow = {
  id: number;
  name: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
};

type ConnectionRow = {
  id: number;
  project_id: number;
  telegram_chat_id: string | null;
  telegram_chat_title: string | null;
  forum_enabled: number;
  bot_joined: number;
  bot_is_admin: number;
  can_manage_topics: number;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadRow = {
  id: number;
  project_id: number;
  title: string;
  telegram_topic_id: number;
  telegram_topic_name: string | null;
  codex_session_id: string | null;
  origin: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  thread_id: number;
  role: string;
  content: string;
  source: string;
  sender_name: string | null;
  sender_telegram_user_id: string | null;
  telegram_message_id: number | null;
  error_text: string | null;
  created_at: string;
};

function resolveDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  return path.resolve(process.cwd(), configuredPath);
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function columnExists(tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

const databasePath = resolveDatabasePath();
ensureParentDirectory(databasePath);

export const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_telegram_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    telegram_chat_id TEXT,
    telegram_chat_title TEXT,
    forum_enabled INTEGER NOT NULL DEFAULT 0,
    bot_joined INTEGER NOT NULL DEFAULT 0,
    bot_is_admin INTEGER NOT NULL DEFAULT 0,
    can_manage_topics INTEGER NOT NULL DEFAULT 0,
    last_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    telegram_topic_id INTEGER NOT NULL,
    telegram_topic_name TEXT,
    codex_session_id TEXT,
    origin TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    sender_name TEXT,
    sender_telegram_user_id TEXT,
    telegram_message_id INTEGER,
    error_text TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );
`);

ensureColumn("threads", "telegram_topic_name", "telegram_topic_name TEXT");
ensureColumn("threads", "codex_session_id", "codex_session_id TEXT");
ensureColumn("threads", "origin", "origin TEXT NOT NULL DEFAULT 'app'");
ensureColumn("messages", "source", "source TEXT NOT NULL DEFAULT 'web'");
ensureColumn("messages", "sender_name", "sender_name TEXT");
ensureColumn("messages", "sender_telegram_user_id", "sender_telegram_user_id TEXT");
ensureColumn("messages", "telegram_message_id", "telegram_message_id INTEGER");
ensureColumn("messages", "error_text", "error_text TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_project_topic_unique ON threads(project_id, telegram_topic_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_telegram_message_unique
    ON messages(thread_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
`);

function mapConnection(row: ConnectionRow | undefined): ConnectionRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    telegramChatId: row.telegram_chat_id,
    telegramChatTitle: row.telegram_chat_title,
    forumEnabled: Boolean(row.forum_enabled),
    botJoined: Boolean(row.bot_joined),
    botIsAdmin: Boolean(row.bot_is_admin),
    canManageTopics: Boolean(row.can_manage_topics),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProject(row: ProjectRow, connection?: ConnectionRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connection: mapConnection(connection),
  };
}

function mapThread(row: ThreadRow): ThreadRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    telegramTopicId: row.telegram_topic_id,
    telegramTopicName: row.telegram_topic_name,
    codexSessionId: row.codex_session_id,
    origin: row.origin,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    content: row.content,
    source: row.source,
    senderName: row.sender_name,
    senderTelegramUserId: row.sender_telegram_user_id,
    telegramMessageId: row.telegram_message_id,
    errorText: row.error_text,
    createdAt: row.created_at,
  };
}

const selectProjectRow = db.prepare("SELECT * FROM projects WHERE id = ?");
const selectConnectionRow = db.prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?");
const selectThreadRow = db.prepare("SELECT * FROM threads WHERE id = ?");

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;

  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `
      INSERT INTO global_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
  ).run(key, value, nowIso());
}

export function isSetupComplete(): boolean {
  const appName = getSetting("app_name");
  const botToken = getSetting("bot_token");
  const projectCountRow = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };

  return Boolean(appName && botToken && projectCountRow.count > 0);
}

export function getPublicSettings(): {
  appName: string | null;
  telegramPollingEnabled: boolean;
  codexBin: string;
} {
  return {
    appName: getSetting("app_name"),
    telegramPollingEnabled: true,
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
  };
}

function ensureConnectionRow(projectId: number): ConnectionRecord {
  const existing = selectConnectionRow.get(projectId) as ConnectionRow | undefined;
  if (existing) {
    return mapConnection(existing)!;
  }

  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        INSERT INTO project_telegram_connections (
          project_id,
          telegram_chat_id,
          telegram_chat_title,
          forum_enabled,
          bot_joined,
          bot_is_admin,
          can_manage_topics,
          last_verified_at,
          created_at,
          updated_at
        )
        VALUES (?, NULL, NULL, 0, 0, 0, 0, NULL, ?, ?)
      `,
    )
    .run(projectId, timestamp, timestamp);

  return mapConnection(
    db.prepare("SELECT * FROM project_telegram_connections WHERE id = ?").get(Number(result.lastInsertRowid)) as
      | ConnectionRow
      | undefined,
  )!;
}

export function getProjectById(projectId: number): ProjectRecord | null {
  const projectRow = selectProjectRow.get(projectId) as ProjectRow | undefined;
  if (!projectRow) {
    return null;
  }

  const connection = selectConnectionRow.get(projectId) as ConnectionRow | undefined;
  return mapProject(projectRow, connection);
}

export function getProjectByTelegramChatId(telegramChatId: string): ProjectRecord | null {
  const row = db
    .prepare(
      `
        SELECT p.*
        FROM projects p
        INNER JOIN project_telegram_connections c ON c.project_id = p.id
        WHERE c.telegram_chat_id = ?
      `,
    )
    .get(telegramChatId) as ProjectRow | undefined;

  if (!row) {
    return null;
  }

  return getProjectById(row.id);
}

export function listProjectsTree(): ProjectTreeRecord[] {
  const projects = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];

  return projects.map((projectRow) => {
    const connection = selectConnectionRow.get(projectRow.id) as ConnectionRow | undefined;
    const threadRows = db
      .prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC")
      .all(projectRow.id) as ThreadRow[];

    return {
      ...mapProject(projectRow, connection),
      threads: threadRows.map(mapThread),
    };
  });
}

export function createProject(input: { name: string; folderPath: string; telegramChatId?: string | null }): ProjectRecord {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        INSERT INTO projects (name, folder_path, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(input.name, input.folderPath, timestamp, timestamp);

  const projectId = Number(result.lastInsertRowid);
  ensureConnectionRow(projectId);

  if (input.telegramChatId !== undefined) {
    saveProjectConnectionInput(projectId, input.telegramChatId);
  }

  return getProjectById(projectId)!;
}

export function updateProject(projectId: number, input: { name: string; folderPath: string }): ProjectRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        UPDATE projects
        SET name = ?, folder_path = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(input.name, input.folderPath, timestamp, projectId);

  if (result.changes === 0) {
    return null;
  }

  return getProjectById(projectId);
}

export function saveProjectConnectionInput(projectId: number, telegramChatId: string | null): ConnectionRecord {
  const connection = ensureConnectionRow(projectId);
  const timestamp = nowIso();
  const chatId = telegramChatId?.trim() || null;
  const hasChatChanged = connection.telegramChatId !== chatId;

  db.prepare(
    `
      UPDATE project_telegram_connections
      SET
        telegram_chat_id = ?,
        telegram_chat_title = CASE WHEN ? THEN NULL ELSE telegram_chat_title END,
        forum_enabled = CASE WHEN ? THEN 0 ELSE forum_enabled END,
        bot_joined = CASE WHEN ? THEN 0 ELSE bot_joined END,
        bot_is_admin = CASE WHEN ? THEN 0 ELSE bot_is_admin END,
        can_manage_topics = CASE WHEN ? THEN 0 ELSE can_manage_topics END,
        last_verified_at = CASE WHEN ? THEN NULL ELSE last_verified_at END,
        updated_at = ?
      WHERE project_id = ?
    `,
  ).run(
    chatId,
    hasChatChanged ? 1 : 0,
    hasChatChanged ? 1 : 0,
    hasChatChanged ? 1 : 0,
    hasChatChanged ? 1 : 0,
    hasChatChanged ? 1 : 0,
    hasChatChanged ? 1 : 0,
    timestamp,
    projectId,
  );

  return mapConnection(selectConnectionRow.get(projectId) as ConnectionRow | undefined)!;
}

export function updateVerifiedConnection(
  projectId: number,
  input: {
    telegramChatId: string;
    telegramChatTitle: string;
    forumEnabled: boolean;
    botJoined: boolean;
    botIsAdmin: boolean;
    canManageTopics: boolean;
    lastVerifiedAt: string;
  },
): ConnectionRecord {
  ensureConnectionRow(projectId);
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE project_telegram_connections
      SET
        telegram_chat_id = ?,
        telegram_chat_title = ?,
        forum_enabled = ?,
        bot_joined = ?,
        bot_is_admin = ?,
        can_manage_topics = ?,
        last_verified_at = ?,
        updated_at = ?
      WHERE project_id = ?
    `,
  ).run(
    input.telegramChatId,
    input.telegramChatTitle,
    input.forumEnabled ? 1 : 0,
    input.botJoined ? 1 : 0,
    input.botIsAdmin ? 1 : 0,
    input.canManageTopics ? 1 : 0,
    input.lastVerifiedAt,
    timestamp,
    projectId,
  );

  return mapConnection(selectConnectionRow.get(projectId) as ConnectionRow | undefined)!;
}

export function createThread(input: {
  projectId: number;
  title: string;
  telegramTopicId: number;
  telegramTopicName?: string | null;
  codexSessionId?: string | null;
  origin?: string;
  status?: string;
}): ThreadRecord {
  const timestamp = nowIso();
  const threadStatus = input.status ?? "open";
  const origin = input.origin ?? "app";
  const result = db
    .prepare(
      `
        INSERT INTO threads (
          project_id,
          title,
          telegram_topic_id,
          telegram_topic_name,
          codex_session_id,
          origin,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.projectId,
      input.title,
      input.telegramTopicId,
      input.telegramTopicName ?? input.title,
      input.codexSessionId ?? null,
      origin,
      threadStatus,
      timestamp,
      timestamp,
    );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, input.projectId);

  return mapThread(selectThreadRow.get(Number(result.lastInsertRowid)) as ThreadRow);
}

export function getThreadById(threadId: number): ThreadRecord | null {
  const row = selectThreadRow.get(threadId) as ThreadRow | undefined;
  return row ? mapThread(row) : null;
}

export function getThreadByProjectAndTelegramTopic(projectId: number, telegramTopicId: number): ThreadRecord | null {
  const row = db
    .prepare("SELECT * FROM threads WHERE project_id = ? AND telegram_topic_id = ?")
    .get(projectId, telegramTopicId) as ThreadRow | undefined;

  return row ? mapThread(row) : null;
}

export function updateThreadCodexSession(threadId: number, codexSessionId: string): ThreadRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        UPDATE threads
        SET codex_session_id = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(codexSessionId, timestamp, threadId);

  if (result.changes === 0) {
    return null;
  }

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
  const nextTopicName =
    input.telegramTopicName !== undefined ? input.telegramTopicName : existing.telegramTopicName ?? existing.title;
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE threads
      SET title = ?, telegram_topic_name = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(nextTitle, nextTopicName, timestamp, threadId);

  return getThreadById(threadId);
}

export function deleteThread(threadId: number): boolean {
  const existing = getThreadById(threadId);
  if (!existing) {
    return false;
  }

  const timestamp = nowIso();
  const result = db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
  if (result.changes === 0) {
    return false;
  }

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, existing.projectId);
  return true;
}

export function findMessageByTelegramMessageId(threadId: number, telegramMessageId: number): MessageRecord | null {
  const row = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? AND telegram_message_id = ?")
    .get(threadId, telegramMessageId) as MessageRow | undefined;

  return row ? mapMessage(row) : null;
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
}): MessageRecord {
  const timestamp = nowIso();
  const source = input.source ?? "web";
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
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.threadId,
      input.role,
      input.content,
      source,
      input.senderName ?? null,
      input.senderTelegramUserId ?? null,
      input.telegramMessageId ?? null,
      input.errorText ?? null,
      timestamp,
    );

  const thread = getThreadById(input.threadId);
  if (thread) {
    db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(timestamp, thread.id);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, thread.projectId);
  }

  return mapMessage(
    db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid)) as MessageRow,
  );
}

export function listMessagesByThread(threadId: number): MessageRecord[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC")
    .all(threadId) as MessageRow[];

  return rows.map(mapMessage);
}

export function createInitialSetup(input: {
  appName: string;
  botToken: string;
  firstProjectName: string;
  firstProjectFolderPath: string;
  telegramChatId: string;
  telegramChatTitle: string;
  forumEnabled: boolean;
  botJoined: boolean;
  botIsAdmin: boolean;
  canManageTopics: boolean;
}): ProjectRecord {
  const transaction = db.transaction(() => {
    setSetting("app_name", input.appName);
    setSetting("bot_token", input.botToken);

    const project = createProject({
      name: input.firstProjectName,
      folderPath: input.firstProjectFolderPath,
      telegramChatId: input.telegramChatId,
    });

    updateVerifiedConnection(project.id, {
      telegramChatId: input.telegramChatId,
      telegramChatTitle: input.telegramChatTitle,
      forumEnabled: input.forumEnabled,
      botJoined: input.botJoined,
      botIsAdmin: input.botIsAdmin,
      canManageTopics: input.canManageTopics,
      lastVerifiedAt: nowIso(),
    });

    return getProjectById(project.id)!;
  });

  return transaction();
}

export function getBotToken(): string | null {
  return getSetting("bot_token");
}
