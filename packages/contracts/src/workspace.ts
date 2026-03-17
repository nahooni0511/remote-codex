import type { CodexPermissionMode, ThreadMode } from "./core";
import type {
  ComposerAttachmentRecord,
  MessageEventRecord,
} from "./messaging";
import type {
  CapabilitySummary,
  DeviceProfile,
  IntegrationSummary,
  TelegramAuthSummary,
  TelegramProjectBindingRecord,
  TelegramThreadBindingRecord,
} from "./integrations";
import type { ThreadLiveStreamSnapshot } from "./realtime";

export interface ProjectRecord {
  id: number;
  name: string;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  telegramBinding: TelegramProjectBindingRecord | null;
  connection?: TelegramProjectBindingRecord | null;
}

export interface ThreadRecord {
  id: number;
  projectId: number;
  title: string;
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
  telegramTopicId?: number;
  telegramTopicName?: string | null;
}

export interface ThreadComposerSettings {
  defaultMode: ThreadMode;
  modelOverride: string | null;
  reasoningEffortOverride: string | null;
  permissionMode: CodexPermissionMode;
}

export interface ThreadListItem extends ThreadRecord {
  effectiveModel: string;
  effectiveReasoningEffort: string | null;
  running: boolean;
  queueDepth: number;
  currentMode: ThreadMode;
  composerSettings: ThreadComposerSettings;
}

export interface ProjectTreeRecord extends ProjectRecord {
  threads: ThreadListItem[];
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
  telegramApiId?: string;
  telegramApiHash?: string;
  telegramPhoneNumber?: string;
  telegramBotToken?: string;
  telegramUserName?: string;
  telegramBotUserName?: string;
}

export interface RuntimeSummary {
  appVersion: string;
  version: string | null;
}

export interface ConfigSelectOption {
  value: string;
  label: string;
}

export interface ComposerModelOption {
  value: string;
  label: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: string[];
}

export interface ProjectGitState {
  isRepo: boolean;
  currentBranch: string | null;
  branches: string[];
  canCreateBranch: boolean;
  undoSupported: boolean;
}

export interface ProjectFileNode {
  name: string;
  path: string;
  relativePath: string;
  kind: "directory" | "file";
  hasChildren: boolean;
}

export interface LocalBootstrap {
  device: DeviceProfile;
  capabilities: CapabilitySummary;
  integrations: IntegrationSummary;
  runtime: RuntimeSummary;
  settings: PublicSettings;
  configOptions: {
    responseLanguages: ConfigSelectOption[];
    defaultModels: ConfigSelectOption[];
    codexModels: ComposerModelOption[];
  };
  workspace: {
    projects: ProjectTreeRecord[];
  };
  projects: ProjectTreeRecord[];
  setupComplete: boolean;
  auth: TelegramAuthSummary;
}

export type AppBootstrap = LocalBootstrap;

export interface ThreadMessagesResponse {
  thread: ThreadListItem;
  events: MessageEventRecord[];
  messages: MessageEventRecord[];
  hasMoreBefore: boolean;
  liveStream: ThreadLiveStreamSnapshot | null;
}

export interface ThreadComposerSettingsResponse {
  thread: ThreadListItem;
}

export interface ProjectGitStateResponse {
  git: ProjectGitState;
}

export interface ProjectFileTreeResponse {
  rootPath: string;
  currentPath: string;
  entries: ProjectFileNode[];
}

export interface AttachmentUploadResponse {
  attachment: ComposerAttachmentRecord;
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
  source: "git" | "npm";
  packageName?: string | null;
  registry?: string | null;
  targetVersion?: string | null;
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
