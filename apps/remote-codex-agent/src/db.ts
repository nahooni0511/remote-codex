import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";
import type {
  ChannelKind,
  CodexPermissionMode,
  ComposerAttachmentRecord,
  DeliveryStatus,
  MessageDisplayHints,
  MessageEventKind,
  MessageEventPayload,
  ThreadComposerSettings,
  ThreadMode,
  TurnSummaryPayload,
  TurnUndoState,
} from "@remote-codex/contracts";

import { repoRoot } from "./lib/paths";
import { syncCanonicalTablesFromLegacy } from "./db/migrations";

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
  telegramBinding: ConnectionRecord | null;
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
  defaultMode: ThreadMode;
  codexPermissionMode: CodexPermissionMode;
  origin: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  telegramBinding: TelegramThreadBindingRecord | null;
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

export interface MessageEventRecord {
  id: number;
  threadId: number;
  kind: MessageEventKind;
  role: string;
  content: string;
  originChannel: ChannelKind;
  originActor: string | null;
  displayHints: MessageDisplayHints;
  errorText: string | null;
  attachmentKind: string | null;
  attachmentMimeType: string | null;
  attachmentFilename: string | null;
  payload: MessageEventPayload;
  createdAt: string;
}

export interface MessageEventDeliveryRecord {
  id: number;
  eventId: number;
  channel: ChannelKind;
  status: DeliveryStatus;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramThreadBindingRecord {
  id: number;
  threadId: number;
  telegramTopicId: number;
  telegramTopicName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceProfileRecord {
  localDeviceId: string;
  displayName: string;
  hostName: string;
  os: string;
  platform: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface GlobalPairingRecord {
  id: number;
  enabled: boolean;
  deviceId: string | null;
  deviceSecret: string | null;
  ownerLabel: string | null;
  serverUrl: string | null;
  wsUrl: string | null;
  connected: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface CodexTurnRunRecord {
  id: number;
  threadId: number;
  mode: ThreadMode;
  modelId: string;
  reasoningEffort: string | null;
  permissionMode: CodexPermissionMode;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  branchAtStart: string | null;
  branchAtEnd: string | null;
  repoCleanAtStart: boolean;
  undoState: TurnUndoState;
  exploredFilesCount: number | null;
  changedFiles: TurnSummaryPayload["changedFiles"];
  repoStatusAfter: string | null;
  summaryEventId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodexSettingsRecord {
  responseLanguage: string;
  defaultModel: string;
  defaultReasoningEffort: string;
}

export type ProjectRow = {
  id: number;
  name: string;
  folder_path: string;
  created_at: string;
  updated_at: string;
};

export type ConnectionRow = {
  id: number;
  project_id: number;
  telegram_chat_id: string | null;
  telegram_access_hash: string | null;
  telegram_chat_title: string | null;
  forum_enabled: number;
  created_at: string;
  updated_at: string;
};

export type ThreadRow = {
  id: number;
  project_id: number;
  title: string;
  telegram_topic_id: number;
  telegram_topic_name: string | null;
  codex_thread_id: string | null;
  codex_model_override: string | null;
  codex_reasoning_effort_override: string | null;
  default_mode: ThreadMode;
  codex_permission_mode: CodexPermissionMode;
  origin: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
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

export type TelegramThreadBindingRow = {
  id: number;
  thread_id: number;
  telegram_topic_id: number;
  telegram_topic_name: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageEventRow = {
  id: number;
  legacy_message_id: number | null;
  thread_id: number;
  kind: MessageEventKind;
  role: string;
  content: string;
  origin_channel: ChannelKind;
  origin_actor: string | null;
  display_hints_json: string;
  error_text: string | null;
  attachment_kind: string | null;
  attachment_path: string | null;
  attachment_mime_type: string | null;
  attachment_filename: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageEventDeliveryRow = {
  id: number;
  event_id: number;
  channel: ChannelKind;
  status: DeliveryStatus;
  detail: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceProfileRow = {
  id: number;
  local_device_id: string;
  display_name: string;
  host_name: string;
  os: string;
  platform: string;
  app_version: string;
  created_at: string;
  updated_at: string;
};

export type GlobalPairingRow = {
  id: number;
  enabled: number;
  device_id: string | null;
  device_secret: string | null;
  owner_label: string | null;
  server_url: string | null;
  ws_url: string | null;
  connected: number;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CronJobRow = {
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

export type CronJobRunRow = {
  id: number;
  cron_job_id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  notify_sent: number;
  error_text: string | null;
  created_at: string;
};

export type CodexTurnRunRow = {
  id: number;
  thread_id: number;
  mode: ThreadMode;
  model_id: string;
  reasoning_effort: string | null;
  permission_mode: CodexPermissionMode;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  branch_at_start: string | null;
  branch_at_end: string | null;
  repo_clean_at_start: number;
  undo_state: TurnUndoState;
  explored_files_count: number | null;
  changed_files_json: string | null;
  repo_status_after: string | null;
  summary_event_id: number | null;
  created_at: string;
  updated_at: string;
};

export type CronJobListRow = CronJobRow & {
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
    default_mode TEXT NOT NULL DEFAULT 'default',
    codex_permission_mode TEXT NOT NULL DEFAULT 'default',
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

  CREATE TABLE IF NOT EXISTS device_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    local_device_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    host_name TEXT NOT NULL,
    os TEXT NOT NULL,
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS global_pairing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    device_id TEXT,
    device_secret TEXT,
    owner_label TEXT,
    server_url TEXT,
    ws_url TEXT,
    connected INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_project_bindings (
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

  CREATE TABLE IF NOT EXISTS telegram_thread_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL UNIQUE,
    telegram_topic_id INTEGER NOT NULL,
    telegram_topic_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_message_id INTEGER UNIQUE,
    thread_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    origin_channel TEXT NOT NULL,
    origin_actor TEXT,
    display_hints_json TEXT NOT NULL,
    error_text TEXT,
    attachment_kind TEXT,
    attachment_path TEXT,
    attachment_mime_type TEXT,
    attachment_filename TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (legacy_message_id) REFERENCES messages(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS message_event_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS telegram_message_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    thread_id INTEGER NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(thread_id, telegram_message_id),
    FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE CASCADE,
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

  CREATE TABLE IF NOT EXISTS codex_turn_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    model_id TEXT NOT NULL,
    reasoning_effort TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    branch_at_start TEXT,
    branch_at_end TEXT,
    repo_clean_at_start INTEGER NOT NULL DEFAULT 0,
    undo_state TEXT NOT NULL DEFAULT 'not_available',
    explored_files_count INTEGER,
    changed_files_json TEXT,
    repo_status_after TEXT,
    summary_event_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (summary_event_id) REFERENCES message_events(id) ON DELETE SET NULL
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
ensureColumnExists("threads", "default_mode", "TEXT NOT NULL DEFAULT 'default'");
ensureColumnExists("threads", "codex_permission_mode", "TEXT NOT NULL DEFAULT 'default'");
ensureColumnExists("message_events", "payload_json", "TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_project_topic_unique ON threads(project_id, telegram_topic_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_message_events_thread_id ON message_events(thread_id);
  CREATE INDEX IF NOT EXISTS idx_message_event_deliveries_event_id ON message_event_deliveries(event_id);
  CREATE INDEX IF NOT EXISTS idx_codex_turn_runs_thread_id ON codex_turn_runs(thread_id);
  CREATE INDEX IF NOT EXISTS idx_codex_turn_runs_summary_event_id ON codex_turn_runs(summary_event_id);
  CREATE INDEX IF NOT EXISTS idx_telegram_project_bindings_project_id ON telegram_project_bindings(project_id);
  CREATE INDEX IF NOT EXISTS idx_telegram_thread_bindings_thread_id ON telegram_thread_bindings(thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_telegram_message_unique
    ON messages(thread_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_message_refs_thread_message_unique
    ON telegram_message_refs(thread_id, telegram_message_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_thread_id ON cron_jobs(thread_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run_at ON cron_jobs(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_cron_job_id ON cron_job_runs(cron_job_id);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status);
`);

function parseDisplayHints(value: string | null | undefined): MessageDisplayHints {
  if (!value) {
    return {
      hideOrigin: true,
      accent: "default",
      localSenderName: null,
      telegramSenderName: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as Partial<MessageDisplayHints>;
    return {
      hideOrigin: parsed.hideOrigin !== false,
      accent:
        parsed.accent === "progress" || parsed.accent === "cron" || parsed.accent === "error"
          ? parsed.accent
          : "default",
      localSenderName: typeof parsed.localSenderName === "string" ? parsed.localSenderName : null,
      telegramSenderName: typeof parsed.telegramSenderName === "string" ? parsed.telegramSenderName : null,
    };
  } catch {
    return {
      hideOrigin: true,
      accent: "default",
      localSenderName: null,
      telegramSenderName: null,
    };
  }
}

function parseThreadMode(value: string | null | undefined): ThreadMode {
  return value === "plan" ? "plan" : "default";
}

function parsePermissionMode(value: string | null | undefined): CodexPermissionMode {
  return value === "danger-full-access" ? "danger-full-access" : "default";
}

function parseMessagePayload(value: string | null | undefined): MessageEventPayload {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as MessageEventPayload;
  } catch {
    return null;
  }
}

function parseChangedFiles(value: string | null | undefined): TurnSummaryPayload["changedFiles"] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as TurnSummaryPayload["changedFiles"];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapTelegramThreadBinding(row?: TelegramThreadBindingRow): TelegramThreadBindingRecord | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    threadId: row.thread_id,
    telegramTopicId: row.telegram_topic_id,
    telegramTopicName: row.telegram_topic_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConnection(row?: ConnectionRow): ConnectionRecord | null {
  if (!row || (!row.telegram_chat_id && !row.telegram_access_hash && !row.telegram_chat_title)) {
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

export function mapProject(row: ProjectRow, connection?: ConnectionRow): ProjectRecord {
  const mappedConnection = mapConnection(connection);
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    connection: mappedConnection,
    telegramBinding: mappedConnection,
  };
}

export function mapThread(row: ThreadRow, telegramBinding?: TelegramThreadBindingRow): ThreadRecord {
  const mappedBinding = mapTelegramThreadBinding(telegramBinding);
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    telegramTopicId: row.telegram_topic_id,
    telegramTopicName: row.telegram_topic_name,
    codexThreadId: row.codex_thread_id,
    codexModelOverride: row.codex_model_override,
    codexReasoningEffortOverride: row.codex_reasoning_effort_override,
    defaultMode: parseThreadMode(row.default_mode),
    codexPermissionMode: parsePermissionMode(row.codex_permission_mode),
    origin: row.origin,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    telegramBinding: mappedBinding,
  };
}

export function mapMessage(row: MessageRow): MessageRecord {
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

export function mapMessageEvent(row: MessageEventRow): MessageEventRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind,
    role: row.role,
    content: row.content,
    originChannel: row.origin_channel,
    originActor: row.origin_actor,
    displayHints: parseDisplayHints(row.display_hints_json),
    errorText: row.error_text,
    attachmentKind: row.attachment_kind,
    attachmentMimeType: row.attachment_mime_type,
    attachmentFilename: row.attachment_filename,
    payload: parseMessagePayload(row.payload_json),
    createdAt: row.created_at,
  };
}

export function mapMessageEventDelivery(row: MessageEventDeliveryRow): MessageEventDeliveryRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDeviceProfile(row: DeviceProfileRow): DeviceProfileRecord {
  return {
    localDeviceId: row.local_device_id,
    displayName: row.display_name,
    hostName: row.host_name,
    os: row.os,
    platform: row.platform,
    appVersion: row.app_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapGlobalPairing(row: GlobalPairingRow): GlobalPairingRecord {
  return {
    id: row.id,
    enabled: Boolean(row.enabled),
    deviceId: row.device_id,
    deviceSecret: row.device_secret,
    ownerLabel: row.owner_label,
    serverUrl: row.server_url,
    wsUrl: row.ws_url,
    connected: Boolean(row.connected),
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCodexTurnRun(row: CodexTurnRunRow): CodexTurnRunRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    mode: parseThreadMode(row.mode),
    modelId: row.model_id,
    reasoningEffort: row.reasoning_effort,
    permissionMode: parsePermissionMode(row.permission_mode),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    branchAtStart: row.branch_at_start,
    branchAtEnd: row.branch_at_end,
    repoCleanAtStart: Boolean(row.repo_clean_at_start),
    undoState: row.undo_state,
    exploredFilesCount: row.explored_files_count,
    changedFiles: parseChangedFiles(row.changed_files_json),
    repoStatusAfter: row.repo_status_after,
    summaryEventId: row.summary_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCronJob(row: CronJobRow): CronJobRecord {
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

export function mapCronJobRun(row: CronJobRunRow): CronJobRunRecord {
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

export function mapCronJobListItem(row: CronJobListRow): CronJobListItem {
  return {
    ...mapCronJob(row),
    projectId: row.project_id,
    projectName: row.project_name,
    threadTitle: row.thread_title,
    running: Boolean(row.running),
  };
}

export function ensureTelegramProjectBindingRow(projectId: number): void {
  const existing = db.prepare("SELECT id FROM telegram_project_bindings WHERE project_id = ?").get(projectId) as
    | { id: number }
    | undefined;
  if (existing) {
    return;
  }

  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO telegram_project_bindings (
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

export function saveTelegramThreadBinding(threadId: number, telegramTopicId: number, telegramTopicName: string | null): void {
  const timestamp = nowIso();
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
  ).run(threadId, telegramTopicId, telegramTopicName, timestamp, timestamp);
}

export function resolveOriginChannel(source: string | null | undefined): ChannelKind {
  if (source === "telegram" || source === "telegram-command") {
    return "telegram";
  }
  if (source === "global-ui") {
    return "global-ui";
  }
  return "local-ui";
}

export function resolveEventKind(input: {
  role: string;
  source: string;
  content: string;
  errorText?: string | null;
  attachmentKind?: string | null;
}): MessageEventKind {
  if (input.attachmentKind) {
    return "artifact_event";
  }
  if (input.errorText || input.source === "system") {
    return "error_event";
  }
  if (input.source === "cron") {
    return "cron_event";
  }
  if (input.role === "assistant") {
    return "assistant_message";
  }
  if (input.role === "user") {
    return "user_message";
  }
  if (input.source === "codex" && input.content.startsWith("Codex plan")) {
    return "plan_event";
  }
  if (input.source === "codex") {
    return "progress_event";
  }
  return "system_message";
}

export function resolveDisplayHints(input: {
  source: string;
  role: string;
  senderName?: string | null;
  errorText?: string | null;
}): MessageDisplayHints {
  return {
    hideOrigin: true,
    accent: input.errorText
      ? "error"
      : input.source === "cron"
        ? "cron"
        : input.source === "codex" && input.role === "system"
          ? "progress"
          : "default",
    localSenderName: input.senderName ?? null,
    telegramSenderName: input.senderName ?? null,
  };
}

export * from "./db/settings";
export * from "./db/projects";
export * from "./db/threads";
export * from "./db/cron";
export * from "./db/migrations";

syncCanonicalTablesFromLegacy();
