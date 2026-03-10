import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const DEFAULT_DATABASE_PATH = "./data/app.db";

export interface TelegramAuthRecord {
  appName: string | null;
  apiId: number | null;
  apiHash: string | null;
  phoneNumber: string | null;
  sessionString: string | null;
  userId: string | null;
  userName: string | null;
  isAuthenticated: boolean;
}

export interface ConnectionRecord {
  id: number;
  projectId: number;
  telegramChatId: string | null;
  telegramAccessHash: string | null;
  telegramChatTitle: string | null;
  forumEnabled: boolean;
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
  telegram_access_hash: string | null;
  telegram_chat_title: string | null;
  forum_enabled: number;
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
    telegram_access_hash TEXT,
    telegram_chat_title TEXT,
    forum_enabled INTEGER NOT NULL DEFAULT 0,
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

function columnExists(tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(tableName: string, definition: string): void {
  const columnName = definition.split(" ")[0];
  if (!columnExists(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

ensureColumn("project_telegram_connections", "telegram_access_hash TEXT");
ensureColumn("project_telegram_connections", "forum_enabled INTEGER NOT NULL DEFAULT 0");
ensureColumn("threads", "telegram_topic_name TEXT");
ensureColumn("threads", "codex_session_id TEXT");
ensureColumn("threads", "origin TEXT NOT NULL DEFAULT 'app'");
ensureColumn("threads", "status TEXT NOT NULL DEFAULT 'open'");
ensureColumn("messages", "source TEXT NOT NULL DEFAULT 'web'");
ensureColumn("messages", "sender_name TEXT");
ensureColumn("messages", "sender_telegram_user_id TEXT");
ensureColumn("messages", "telegram_message_id INTEGER");
ensureColumn("messages", "error_text TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_project_topic_unique ON threads(project_id, telegram_topic_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_telegram_message_unique
    ON messages(thread_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
`);

function mapConnection(row?: ConnectionRow): ConnectionRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectId: row.project_id,
    telegramChatId: row.telegram_chat_id,
    telegramAccessHash: row.telegram_access_hash,
    telegramChatTitle: row.telegram_chat_title,
    forumEnabled: Boolean(row.forum_enabled),
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

export function getTelegramAuth(): TelegramAuthRecord {
  const appName = getSetting("app_name");
  const apiId = Number(getSetting("telegram_api_id") || 0) || null;
  const apiHash = getSetting("telegram_api_hash");
  const phoneNumber = getSetting("telegram_phone_number");
  const sessionString = getSetting("telegram_session_string");
  const userId = getSetting("telegram_user_id");
  const userName = getSetting("telegram_user_name");

  return {
    appName,
    apiId,
    apiHash,
    phoneNumber,
    sessionString,
    userId,
    userName,
    isAuthenticated: Boolean(appName && apiId && apiHash && phoneNumber && sessionString),
  };
}

export function saveTelegramAuth(input: {
  appName: string;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
  userId: string;
  userName: string;
}): void {
  setSetting("app_name", input.appName);
  setSetting("telegram_api_id", String(input.apiId));
  setSetting("telegram_api_hash", input.apiHash);
  setSetting("telegram_phone_number", input.phoneNumber);
  setSetting("telegram_session_string", input.sessionString);
  setSetting("telegram_user_id", input.userId);
  setSetting("telegram_user_name", input.userName);
}

export function clearTelegramAuth(): void {
  const keys = [
    "telegram_api_id",
    "telegram_api_hash",
    "telegram_phone_number",
    "telegram_session_string",
    "telegram_user_id",
    "telegram_user_name",
  ];

  for (const key of keys) {
    db.prepare("DELETE FROM global_settings WHERE key = ?").run(key);
  }
}

export function isSetupComplete(): boolean {
  return getTelegramAuth().isAuthenticated;
}

export function getPublicSettings(): {
  appName: string | null;
  codexBin: string;
  telegramUserName: string | null;
  telegramPhoneNumber: string | null;
} {
  const auth = getTelegramAuth();

  return {
    appName: auth.appName,
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
    telegramUserName: auth.userName,
    telegramPhoneNumber: auth.phoneNumber,
  };
}

function ensureConnectionRow(projectId: number): void {
  const existing = db
    .prepare("SELECT id FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as { id: number } | undefined;

  if (existing) {
    return;
  }

  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO project_telegram_connections (
        project_id,
        telegram_chat_id,
        telegram_access_hash,
        telegram_chat_title,
        forum_enabled,
        created_at,
        updated_at
      )
      VALUES (?, NULL, NULL, NULL, 0, ?, ?)
    `,
  ).run(projectId, timestamp, timestamp);
}

export function listProjectsTree(): ProjectTreeRecord[] {
  const projectRows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, id DESC").all() as ProjectRow[];

  return projectRows.map((projectRow) => {
    const connection = db
      .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
      .get(projectRow.id) as ConnectionRow | undefined;
    const threadRows = db
      .prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC")
      .all(projectRow.id) as ThreadRow[];

    return {
      ...mapProject(projectRow, connection),
      threads: threadRows.map(mapThread),
    };
  });
}

export function getProjectById(projectId: number): ProjectRecord | null {
  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!projectRow) {
    return null;
  }

  const connection = db
    .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as ConnectionRow | undefined;

  return mapProject(projectRow, connection);
}

export function createProject(input: { name: string; folderPath: string }): ProjectRecord {
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

export function saveProjectTelegramConnection(
  projectId: number,
  input: {
    telegramChatId: string;
    telegramAccessHash: string;
    telegramChatTitle: string;
    forumEnabled: boolean;
  },
): ConnectionRecord {
  ensureConnectionRow(projectId);
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE project_telegram_connections
      SET
        telegram_chat_id = ?,
        telegram_access_hash = ?,
        telegram_chat_title = ?,
        forum_enabled = ?,
        updated_at = ?
      WHERE project_id = ?
    `,
  ).run(
    input.telegramChatId,
    input.telegramAccessHash,
    input.telegramChatTitle,
    input.forumEnabled ? 1 : 0,
    timestamp,
    projectId,
  );

  const row = db
    .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as ConnectionRow | undefined;

  return mapConnection(row)!;
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
      input.origin ?? "app",
      input.status ?? "open",
      timestamp,
      timestamp,
    );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, input.projectId);
  return getThreadById(Number(result.lastInsertRowid))!;
}

export function getThreadById(threadId: number): ThreadRecord | null {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
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
    .prepare("UPDATE threads SET codex_session_id = ?, updated_at = ? WHERE id = ?")
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
  const nextTopicName = input.telegramTopicName ?? existing.telegramTopicName ?? existing.title;
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
      input.source ?? "web",
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

  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid)) as MessageRow;
  return mapMessage(row);
}

export function listMessagesByThread(threadId: number): MessageRecord[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC")
    .all(threadId) as MessageRow[];

  return rows.map(mapMessage);
}
