export interface ApiErrorResponse {
  error: string;
  code?: string;
}

export interface TelegramAuthSummary {
  isAuthenticated: boolean;
  phoneNumber: string | null;
  userName: string | null;
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

export type ThreadMode = "default" | "plan" | null;

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

export interface ThreadListItem extends ThreadRecord {
  effectiveModel: string;
  effectiveReasoningEffort: string | null;
  running: boolean;
  queueDepth: number;
  currentMode: ThreadMode;
}

export interface ProjectTreeRecord extends ProjectRecord {
  threads: ThreadListItem[];
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

export interface CronJobListItem {
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
  projectId: number;
  projectName: string;
  threadTitle: string;
  running: boolean;
}

export interface PublicSettings {
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
}

export interface RuntimeSummary {
  appVersion: string;
  version: string | null;
}

export interface ConfigSelectOption {
  value: string;
  label: string;
}

export interface AppBootstrap {
  setupComplete: boolean;
  auth: TelegramAuthSummary;
  runtime: RuntimeSummary;
  settings: PublicSettings;
  configOptions: {
    responseLanguages: ConfigSelectOption[];
    defaultModels: ConfigSelectOption[];
  };
  projects: ProjectTreeRecord[];
}

export interface ThreadMessagesResponse {
  thread: ThreadListItem;
  messages: MessageRecord[];
  hasMoreBefore: boolean;
}

export interface CronJobsResponse {
  jobs: CronJobListItem[];
}

export interface AuthSendCodeResponse {
  pendingAuthId: string;
  phoneNumber: string;
  isCodeViaApp: boolean;
  botUserName: string;
}

export interface AuthPasswordRequiredResponse {
  requiresPassword: true;
  pendingAuthId: string;
  passwordHint: string;
}

export interface AppUpdateStatus {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  currentBranch: string | null;
  upstreamBranch: string | null;
  currentCommit: string | null;
  latestCommit: string | null;
  dirty: boolean;
  updateAvailable: boolean;
  canApply: boolean;
  reason: string | null;
  checkedAt: string;
}

export interface AppUpdateApplyResult extends AppUpdateStatus {
  applied: boolean;
  dependenciesInstalled: boolean;
  buildExecuted: boolean;
  restartRequired: boolean;
}

export interface CodexPlanStep {
  step: string;
  status: string;
}

export interface ThreadStreamRealtimeEvent {
  type: string;
  text?: string;
  phase?: string | null;
  explanation?: string | null;
  plan?: CodexPlanStep[];
}

export type RealtimeEvent =
  | {
      type: "connected";
    }
  | {
      type: "workspace-updated";
      projectId?: number | null;
      threadId?: number | null;
    }
  | {
      type: "thread-messages-updated";
      threadId: number;
    }
  | {
      type: "thread-turn-state";
      threadId: number;
      running: boolean;
      queueDepth: number;
      mode: ThreadMode;
    }
  | {
      type: "thread-stream-event";
      threadId: number;
      event: ThreadStreamRealtimeEvent;
    };
