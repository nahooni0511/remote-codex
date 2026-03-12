import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { repoRoot } from "./lib/paths";

const DEFAULT_DATABASE_PATH = "./data/app.db";

export interface TelegramAuthRecord {
  apiId: number | null;
  apiHash: string | null;
  phoneNumber: string | null;
  sessionString: string | null;
  userId: string | null;
  userName: string | null;
  botToken: string | null;
  botUserId: string | null;
  botUserName: string | null;
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
  codexThreadId: string | null;
  codexModelOverride: string | null;
  codexReasoningEffortOverride: string | null;
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
  attachmentKind: string | null;
  attachmentMimeType: string | null;
  attachmentFilename: string | null;
  createdAt: string;
}

export interface ListMessagesByThreadOptions {
  limit?: number;
  beforeMessageId?: number | null;
  afterMessageId?: number | null;
}

export interface ListMessagesByThreadResult {
  messages: MessageRecord[];
  hasMoreBefore: boolean;
}

export interface MessageAttachmentRecord {
  messageId: number;
  kind: string;
  path: string;
  mimeType: string | null;
  filename: string | null;
}

export interface CronJobRecord {
  id: number;
  threadId: number;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  codexThreadId: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobRunRecord {
  id: number;
  cronJobId: number;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  notifySent: boolean;
  errorText: string | null;
  createdAt: string;
}

export interface CronJobListItem extends CronJobRecord {
  projectId: number;
  projectName: string;
  threadTitle: string;
  running: boolean;
}

export interface ProjectTreeRecord extends ProjectRecord {
  threads: ThreadRecord[];
}

export interface CodexSettingsRecord {
  responseLanguage: string;
  defaultModel: string;
  defaultReasoningEffort: string;
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
  codex_thread_id: string | null;
  codex_model_override: string | null;
  codex_reasoning_effort_override: string | null;
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
  attachment_kind: string | null;
  attachment_path: string | null;
  attachment_mime_type: string | null;
  attachment_filename: string | null;
  created_at: string;
};

type CronJobRow = {
  id: number;
  thread_id: number;
  name: string;
  prompt: string;
  cron_expr: string;
  timezone: string;
  enabled: number;
  codex_thread_id: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type CronJobRunRow = {
  id: number;
  cron_job_id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  notify_sent: number;
  error_text: string | null;
  created_at: string;
};

type CronJobListRow = CronJobRow & {
  project_id: number;
  project_name: string;
  thread_title: string;
  running: number;
};

function resolveDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
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
    codex_thread_id TEXT,
    codex_model_override TEXT,
    codex_reasoning_effort_override TEXT,
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
    attachment_kind TEXT,
    attachment_path TEXT,
    attachment_mime_type TEXT,
    attachment_filename TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cron_expr TEXT NOT NULL,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    codex_thread_id TEXT,
    last_run_at TEXT,
    last_run_status TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cron_job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cron_job_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    notify_sent INTEGER NOT NULL DEFAULT 0,
    error_text TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (cron_job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );
`);

function ensureColumnExists(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

ensureColumnExists("messages", "attachment_kind", "TEXT");
ensureColumnExists("messages", "attachment_path", "TEXT");
ensureColumnExists("messages", "attachment_mime_type", "TEXT");
ensureColumnExists("messages", "attachment_filename", "TEXT");
ensureColumnExists("threads", "codex_thread_id", "TEXT");
ensureColumnExists("threads", "codex_model_override", "TEXT");
ensureColumnExists("threads", "codex_reasoning_effort_override", "TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_project_topic_unique ON threads(project_id, telegram_topic_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_telegram_message_unique
    ON messages(thread_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_thread_id ON cron_jobs(thread_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run_at ON cron_jobs(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_cron_job_id ON cron_job_runs(cron_job_id);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status);
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
    codexThreadId: row.codex_thread_id,
    codexModelOverride: row.codex_model_override,
    codexReasoningEffortOverride: row.codex_reasoning_effort_override,
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
    attachmentKind: row.attachment_kind,
    attachmentMimeType: row.attachment_mime_type,
    attachmentFilename: row.attachment_filename,
    createdAt: row.created_at,
  };
}

function mapCronJob(row: CronJobRow): CronJobRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    name: row.name,
    prompt: row.prompt,
    cronExpr: row.cron_expr,
    timezone: row.timezone,
    enabled: Boolean(row.enabled),
    codexThreadId: row.codex_thread_id,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCronJobRun(row: CronJobRunRow): CronJobRunRecord {
  return {
    id: row.id,
    cronJobId: row.cron_job_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    notifySent: Boolean(row.notify_sent),
    errorText: row.error_text,
    createdAt: row.created_at,
  };
}

function mapCronJobListItem(row: CronJobListRow): CronJobListItem {
  return {
    ...mapCronJob(row),
    projectId: row.project_id,
    projectName: row.project_name,
    threadTitle: row.thread_title,
    running: Boolean(row.running),
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

export function clearSetting(key: string): void {
  db.prepare("DELETE FROM global_settings WHERE key = ?").run(key);
}

function setOptionalSetting(key: string, value: string | null | undefined): void {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    clearSetting(key);
    return;
  }

  setSetting(key, normalized);
}

export function getTelegramAuth(): TelegramAuthRecord {
  const apiId = Number(getSetting("telegram_api_id") || 0) || null;
  const apiHash = getSetting("telegram_api_hash");
  const phoneNumber = getSetting("telegram_phone_number");
  const sessionString = getSetting("telegram_session_string");
  const userId = getSetting("telegram_user_id");
  const userName = getSetting("telegram_user_name");
  const botToken = getSetting("telegram_bot_token");
  const botUserId = getSetting("telegram_bot_user_id");
  const botUserName = getSetting("telegram_bot_username");

  return {
    apiId,
    apiHash,
    phoneNumber,
    sessionString,
    userId,
    userName,
    botToken,
    botUserId,
    botUserName,
    isAuthenticated: Boolean(apiId && apiHash && phoneNumber && sessionString && botToken),
  };
}

export function saveTelegramAuth(input: {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
  userId: string;
  userName: string;
  botToken: string;
  botUserId: string;
  botUserName: string;
}): void {
  setSetting("telegram_api_id", String(input.apiId));
  setSetting("telegram_api_hash", input.apiHash);
  setSetting("telegram_phone_number", input.phoneNumber);
  setSetting("telegram_session_string", input.sessionString);
  setSetting("telegram_user_id", input.userId);
  setSetting("telegram_user_name", input.userName);
  setSetting("telegram_bot_token", input.botToken);
  setSetting("telegram_bot_user_id", input.botUserId);
  setSetting("telegram_bot_username", input.botUserName);
}

export function clearTelegramAuth(): void {
  const keys = [
    "telegram_api_id",
    "telegram_api_hash",
    "telegram_phone_number",
    "telegram_session_string",
    "telegram_user_id",
    "telegram_user_name",
    "telegram_bot_token",
    "telegram_bot_user_id",
    "telegram_bot_username",
  ];

  for (const key of keys) {
    clearSetting(key);
  }
}

export function getCodexSettings(): CodexSettingsRecord {
  return {
    responseLanguage: getSetting("codex_response_language") || "",
    defaultModel: getSetting("codex_default_model") || "",
    defaultReasoningEffort: getSetting("codex_default_reasoning_effort") || "",
  };
}

export function saveCodexSettings(input: {
  responseLanguage?: string | null;
  defaultModel?: string | null;
  defaultReasoningEffort?: string | null;
}): CodexSettingsRecord {
  setOptionalSetting("codex_response_language", input.responseLanguage);
  setOptionalSetting("codex_default_model", input.defaultModel);
  setOptionalSetting("codex_default_reasoning_effort", input.defaultReasoningEffort);
  return getCodexSettings();
}

export function resetCodexSettings(): CodexSettingsRecord {
  clearSetting("codex_response_language");
  clearSetting("codex_default_model");
  clearSetting("codex_default_reasoning_effort");
  return getCodexSettings();
}

export function isSetupComplete(): boolean {
  return getTelegramAuth().isAuthenticated;
}

export function getPublicSettings(): {
  codexBin: string;
  codexResponseLanguage: string;
  codexDefaultModel: string;
  codexDefaultReasoningEffort: string;
  telegramApiId: string;
  telegramApiHash: string;
  telegramPhoneNumber: string;
  telegramBotToken: string;
  telegramUserName: string;
  telegramBotUserName: string;
} {
  const auth = getTelegramAuth();
  const codex = getCodexSettings();

  return {
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
    codexResponseLanguage: codex.responseLanguage,
    codexDefaultModel: codex.defaultModel || process.env.CODEX_MODEL?.trim() || "",
    codexDefaultReasoningEffort:
      codex.defaultReasoningEffort || process.env.CODEX_REASONING_EFFORT?.trim() || "",
    telegramApiId: auth.apiId ? String(auth.apiId) : "",
    telegramApiHash: auth.apiHash || "",
    telegramPhoneNumber: auth.phoneNumber || "",
    telegramBotToken: auth.botToken || "",
    telegramUserName: auth.userName || "",
    telegramBotUserName: auth.botUserName || "",
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

export function getProjectByTelegramChatId(telegramChatId: string): ProjectRecord | null {
  const row = db
    .prepare(
      `
        SELECT p.*
        FROM projects p
        INNER JOIN project_telegram_connections c
          ON c.project_id = p.id
        WHERE c.telegram_chat_id = ?
      `,
    )
    .get(telegramChatId) as ProjectRow | undefined;

  if (!row) {
    return null;
  }

  return getProjectById(row.id);
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

export function deleteProject(projectId: number): boolean {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return result.changes > 0;
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
  codexThreadId?: string | null;
  codexModelOverride?: string | null;
  codexReasoningEffortOverride?: string | null;
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
          codex_thread_id,
          codex_model_override,
          codex_reasoning_effort_override,
          origin,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.projectId,
      input.title,
      input.telegramTopicId,
      input.telegramTopicName ?? input.title,
      input.codexThreadId ?? null,
      input.codexModelOverride ?? null,
      input.codexReasoningEffortOverride ?? null,
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

  db.prepare(
    `
      UPDATE threads
      SET
        codex_model_override = ?,
        codex_reasoning_effort_override = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    nextModelOverride,
    nextReasoningEffortOverride,
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

export function getMessageAttachmentById(messageId: number): MessageAttachmentRecord | null {
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
      .prepare("SELECT * FROM messages WHERE thread_id = ? AND id > ? ORDER BY created_at ASC, id ASC")
      .all(threadId, afterMessageId) as MessageRow[];

    return {
      messages: rows.map(mapMessage),
      hasMoreBefore: db
        .prepare("SELECT 1 FROM messages WHERE thread_id = ? AND id <= ? LIMIT 1")
        .get(threadId, afterMessageId)
        ? true
        : false,
    };
  }

  if (!limit) {
    const rows = db
      .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC")
      .all(threadId) as MessageRow[];

    return {
      messages: rows.map(mapMessage),
      hasMoreBefore: false,
    };
  }

  const query = beforeMessageId
    ? "SELECT * FROM messages WHERE thread_id = ? AND id < ? ORDER BY created_at DESC, id DESC LIMIT ?"
    : "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
  const params = beforeMessageId ? [threadId, beforeMessageId, limit + 1] : [threadId, limit + 1];
  const rows = db.prepare(query).all(...params) as MessageRow[];
  const hasMoreBefore = rows.length > limit;
  const windowRows = (hasMoreBefore ? rows.slice(0, limit) : rows).reverse();

  return {
    messages: windowRows.map(mapMessage),
    hasMoreBefore,
  };
}

export function createCronJob(input: {
  threadId: number;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone: string;
  enabled?: boolean;
  codexThreadId?: string | null;
  nextRunAt?: string | null;
}): CronJobRecord {
  const timestamp = nowIso();
  const result = db.prepare(
    `
      INSERT INTO cron_jobs (
        thread_id,
        name,
        prompt,
        cron_expr,
        timezone,
        enabled,
        codex_thread_id,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.threadId,
    input.name,
    input.prompt,
    input.cronExpr,
    input.timezone,
    input.enabled === false ? 0 : 1,
    input.codexThreadId ?? null,
    input.nextRunAt ?? null,
    timestamp,
    timestamp,
  );

  const thread = getThreadById(input.threadId);
  if (thread) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, thread.projectId);
  }

  return getCronJobById(Number(result.lastInsertRowid))!;
}

export function getCronJobById(jobId: number): CronJobRecord | null {
  const row = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(jobId) as CronJobRow | undefined;
  return row ? mapCronJob(row) : null;
}

function listCronJobsInternal(whereClause = "", values: unknown[] = []): CronJobListItem[] {
  const rows = db.prepare(
    `
      SELECT
        cj.*,
        t.project_id,
        p.name AS project_name,
        t.title AS thread_title,
        EXISTS(
          SELECT 1
          FROM cron_job_runs cjr
          WHERE cjr.cron_job_id = cj.id
            AND cjr.status = 'running'
            AND cjr.finished_at IS NULL
        ) AS running
      FROM cron_jobs cj
      INNER JOIN threads t ON t.id = cj.thread_id
      INNER JOIN projects p ON p.id = t.project_id
      ${whereClause}
      ORDER BY p.updated_at DESC, t.updated_at DESC, cj.created_at DESC, cj.id DESC
    `,
  ).all(...values) as CronJobListRow[];

  return rows.map(mapCronJobListItem);
}

export function listCronJobs(): CronJobListItem[] {
  return listCronJobsInternal();
}

export function listCronJobsByThread(threadId: number): CronJobListItem[] {
  return listCronJobsInternal("WHERE cj.thread_id = ?", [threadId]);
}

export function updateCronJobEnabled(jobId: number, enabled: boolean): CronJobRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare("UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, timestamp, jobId);

  if (result.changes === 0) {
    return null;
  }

  return getCronJobById(jobId);
}

export function updateCronJobCodexThreadId(jobId: number, codexThreadId: string | null): CronJobRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare("UPDATE cron_jobs SET codex_thread_id = ?, updated_at = ? WHERE id = ?")
    .run(codexThreadId, timestamp, jobId);

  if (result.changes === 0) {
    return null;
  }

  return getCronJobById(jobId);
}

export function refreshCronJobNextRunAt(
  jobId: number,
  input: {
    nextRunAt?: string | null;
    lastRunAt?: string | null;
    lastRunStatus?: string | null;
  },
): CronJobRecord | null {
  const existing = getCronJobById(jobId);
  if (!existing) {
    return null;
  }

  const timestamp = nowIso();
  const nextRunAt = input.nextRunAt === undefined ? existing.nextRunAt : input.nextRunAt;
  const lastRunAt = input.lastRunAt === undefined ? existing.lastRunAt : input.lastRunAt;
  const lastRunStatus = input.lastRunStatus === undefined ? existing.lastRunStatus : input.lastRunStatus;

  db.prepare(
    `
      UPDATE cron_jobs
      SET next_run_at = ?, last_run_at = ?, last_run_status = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(nextRunAt, lastRunAt, lastRunStatus, timestamp, jobId);

  return getCronJobById(jobId);
}

export function deleteCronJob(jobId: number): boolean {
  const job = getCronJobById(jobId);
  if (!job) {
    return false;
  }

  const result = db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(jobId);
  if (result.changes === 0) {
    return false;
  }

  const thread = getThreadById(job.threadId);
  if (thread) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), thread.projectId);
  }

  return true;
}

export function createCronJobRun(input: {
  cronJobId: number;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  notifySent?: boolean;
  errorText?: string | null;
}): CronJobRunRecord {
  const createdAt = nowIso();
  const result = db.prepare(
    `
      INSERT INTO cron_job_runs (
        cron_job_id,
        status,
        started_at,
        finished_at,
        notify_sent,
        error_text,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.cronJobId,
    input.status,
    input.startedAt ?? null,
    input.finishedAt ?? null,
    input.notifySent ? 1 : 0,
    input.errorText ?? null,
    createdAt,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(Number(result.lastInsertRowid)) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function touchCronJobRunState(
  runId: number,
  input: {
    status?: string;
    notifySent?: boolean;
    errorText?: string | null;
  },
): CronJobRunRecord | null {
  const existing = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE cron_job_runs
      SET status = ?, notify_sent = ?, error_text = ?
      WHERE id = ?
    `,
  ).run(
    input.status ?? existing.status,
    input.notifySent === undefined ? existing.notify_sent : input.notifySent ? 1 : 0,
    input.errorText === undefined ? existing.error_text : input.errorText,
    runId,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function finishCronJobRun(
  runId: number,
  input: {
    status: string;
    finishedAt?: string | null;
    notifySent?: boolean;
    errorText?: string | null;
  },
): CronJobRunRecord | null {
  const existing = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE cron_job_runs
      SET status = ?, finished_at = ?, notify_sent = ?, error_text = ?
      WHERE id = ?
    `,
  ).run(
    input.status,
    input.finishedAt ?? nowIso(),
    input.notifySent === undefined ? existing.notify_sent : input.notifySent ? 1 : 0,
    input.errorText === undefined ? existing.error_text : input.errorText,
    runId,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function getRunningCronJobRuns(): CronJobRunRecord[] {
  const rows = db
    .prepare("SELECT * FROM cron_job_runs WHERE status = 'running' AND finished_at IS NULL ORDER BY created_at DESC, id DESC")
    .all() as CronJobRunRow[];

  return rows.map(mapCronJobRun);
}
