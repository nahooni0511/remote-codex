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
