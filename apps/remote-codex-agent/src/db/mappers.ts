import type {
  ChannelKind,
  CodexPermissionMode,
  MessageDisplayHints,
  MessageEventKind,
  MessageEventPayload,
  ThreadMode,
  TurnSummaryPayload,
} from "@remote-codex/contracts";

import { db, nowIso } from "./core";
import type {
  CodexTurnRunRecord,
  CodexTurnRunRow,
  ConnectionRecord,
  ConnectionRow,
  CronJobListItem,
  CronJobListRow,
  CronJobRecord,
  CronJobRow,
  CronJobRunRecord,
  CronJobRunRow,
  DeviceProfileRecord,
  DeviceProfileRow,
  GlobalPairingRecord,
  GlobalPairingRow,
  MessageEventDeliveryRecord,
  MessageEventDeliveryRow,
  MessageEventRecord,
  MessageEventRow,
  MessageRecord,
  MessageRow,
  ProjectRecord,
  ProjectRow,
  TelegramThreadBindingRecord,
  TelegramThreadBindingRow,
  ThreadRecord,
  ThreadRow,
} from "./types";

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
