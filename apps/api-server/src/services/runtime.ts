import { exec, execFile } from "node:child_process";
import type { Server as HttpServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { CronJob as ScheduledCronJob, CronTime } from "cron";
import dotenv from "dotenv";
import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { WebSocketServer, WebSocket } from "ws";
import type { AppBootstrap } from "@remote-codex/contracts";

import {
  answerBotCallbackQuery,
  editTopicMessageTextAsBot,
  getBotUpdates,
  getTelegramBotProfile,
  setScopedBotCommands,
  sendTopicDocumentAsBot,
  sendTopicMessageAsBot,
  sendTopicPhotoAsBot,
  sendTopicTypingAsBot,
  type TelegramBotCommand,
  type TelegramBotCallbackUpdate,
  type TelegramInlineKeyboardMarkup,
  TelegramBotApiError,
} from "../bot";
import {
  buildLanguageInstruction,
  CodexExecutionError,
  getCodexRuntimeInfo,
  listCodexModels,
  runCodexTurn,
  shutdownCodexRuntime,
  type CodexArtifact,
  type CodexModelRecord,
  type CodexPlanStep,
  type CodexTurnEvent,
} from "../codex";
import {
  clearSetting,
  clearTelegramAuth,
  createMessage,
  createCronJob as createCronJobRecord,
  createCronJobRun,
  createProject,
  createThread,
  deleteCronJob as deleteCronJobRecord,
  deleteProject,
  deleteThread,
  finishCronJobRun,
  findMessageByTelegramMessageId,
  getCronJobById,
  getRunningCronJobRuns,
  getMessageAttachmentById,
  getSetting,
  getCodexSettings,
  getProjectById,
  getProjectByTelegramChatId,
  getPublicSettings,
  getTelegramAuth,
  getThreadById,
  getThreadByProjectAndTelegramTopic,
  isSetupComplete,
  listCronJobs,
  listCronJobsByThread,
  listMessagesByThread,
  listProjectsTree,
  nowIso,
  refreshCronJobNextRunAt,
  resetCodexSettings,
  saveProjectTelegramConnection,
  saveCodexSettings,
  saveTelegramAuth,
  setSetting,
  touchCronJobRunState,
  updateProject,
  updateCronJobCodexThreadId,
  updateCronJobEnabled,
  updateThreadCodexOverrides,
  updateThreadCodexThreadId,
  updateThreadTopicMetadata,
  type CronJobRecord,
  type ProjectRecord,
  type ThreadRecord,
} from "../db";
import {
  TelegramMtprotoError,
  completePhoneLoginCode,
  completePhoneLoginPassword,
  createForumSupergroup,
  createForumTopic,
  getAuthenticatedClient,
  getForumTopicById,
  getPendingLogin,
  inviteUserToSupergroup,
  markTopicRead,
  sendTopicMessage,
  startPhoneLogin,
  shutdownMtprotoClients,
  type TelegramAuthConfig,
} from "../mtproto";
import { HttpError, assertNonEmptyString } from "../lib/http";
import { artifactsDir, repoRoot, resolveFromRepo } from "../lib/paths";

dotenv.config({ path: resolveFromRepo(".env") });

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
export const PORT = Number(process.env.PORT || 3000);
const externalServicesDisabled = process.env.REMOTE_CODEX_DISABLE_EXTERNAL_SERVICES === "true";
const telegramIncomingMessageEvent = new NewMessage({});
const ignoredTelegramEchoes = new Map<string, number>();
const websocketClients = new Set<WebSocket>();
const DEFAULT_CRON_TIMEZONE = "Asia/Seoul";
const CRON_ACTION_TAG = "remote_codex_cron_actions";
const CRON_ACTION_BLOCK_PATTERN = new RegExp(
  `<${CRON_ACTION_TAG}>\\s*([\\s\\S]*?)\\s*</${CRON_ACTION_TAG}>`,
  "gi",
);

type ThreadStreamRealtimeEvent = {
  type: string;
  text?: string;
  phase?: string | null;
  explanation?: string | null;
  plan?: CodexPlanStep[];
};

type RealtimeEvent =
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
      mode: "default" | "plan" | null;
    }
  | {
      type: "thread-stream-event";
      threadId: number;
      event: ThreadStreamRealtimeEvent;
    };

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

type CronActionPayload = {
  version?: number;
  jobs?: Array<{
    op?: unknown;
    jobId?: unknown;
    id?: unknown;
    name?: unknown;
    prompt?: unknown;
    cronExpr?: unknown;
    timezone?: unknown;
  }>;
};

type RawCronActionJob = NonNullable<CronActionPayload["jobs"]>[number];

type ParsedCronAction =
  | {
      op: "create";
      name: string;
      prompt: string;
      cronExpr: string;
      timezone: string;
    }
  | {
      op: "delete";
      jobId: number | null;
      name: string | null;
    };

type ParsedCronExecutionResponse = {
  notify: boolean;
  message: string;
  summary: string;
};

type AppUpdateStatus = {
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
};

type AppUpdateApplyResult = AppUpdateStatus & {
  applied: boolean;
  dependenciesInstalled: boolean;
  buildExecuted: boolean;
  restartRequired: boolean;
};

type ConfigSelectOption = {
  value: string;
  label: string;
};

const CONFIG_LANGUAGE_OPTIONS: ConfigSelectOption[] = [
  { value: "", label: "비워두기" },
  { value: "Korean", label: "한국어" },
  { value: "English", label: "English" },
  { value: "Japanese", label: "日本語" },
  { value: "Chinese", label: "中文" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
  { value: "German", label: "Deutsch" },
];

let telegramInboundClient: TelegramClient | null = null;
let telegramInboundHandler:
  | ((event: NewMessageEvent) => Promise<void>)
  | null = null;
let botCallbackPollingPromise: Promise<void> | null = null;
let botCallbackPollingStopped = false;
let botCallbackConflictLogged = false;
let botCallbackPollingGeneration = 0;
let codexRuntimeVersion: string | null = null;

type ThreadQueueState = {
  tail: Promise<void>;
  queueDepth: number;
  running: boolean;
  mode: "default" | "plan" | null;
};

const threadQueueStates = new Map<number, ThreadQueueState>();
const scheduledCronJobs = new Map<number, ScheduledCronJob>();
const activeCronJobRuns = new Set<number>();

export function normalizeExistingDirectoryPath(input?: string): string {
  const target = input?.trim() ? path.resolve(input) : path.parse(repoRoot).root;

  if (!fs.existsSync(target)) {
    throw new HttpError(400, "Directory path does not exist.");
  }

  if (!fs.statSync(target).isDirectory()) {
    throw new HttpError(400, "Selected path must be a directory.");
  }

  return target;
}

function directoryHasChildren(targetPath: string): boolean {
  try {
    return fs
      .readdirSync(targetPath, { withFileTypes: true })
      .some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

export function listDirectoryNodes(targetPath: string): FsNode[] {
  const resolvedPath = normalizeExistingDirectoryPath(targetPath);

  try {
    return fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "ko"))
      .slice(0, 300)
      .map((entry) => {
        const entryPath = path.join(resolvedPath, entry.name);

        return {
          name: entry.name,
          path: entryPath,
          hasChildren: directoryHasChildren(entryPath),
        };
      });
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? `Cannot read directory: ${error.message}` : "Cannot read directory.",
    );
  }
}

export function getAuthConfigOrThrow(): TelegramAuthConfig {
  const auth = getTelegramAuth();
  if (!auth.isAuthenticated || !auth.apiId || !auth.apiHash || !auth.phoneNumber || !auth.sessionString) {
    throw new HttpError(400, "Telegram user login is required.");
  }

  return {
    apiId: auth.apiId,
    apiHash: auth.apiHash,
    phoneNumber: auth.phoneNumber,
    sessionString: auth.sessionString,
  };
}

export function getBotConfigOrThrow(): { botToken: string; botUserId: string; botUserName: string } {
  const auth = getTelegramAuth();
  if (!auth.botToken || !auth.botUserId || !auth.botUserName) {
    throw new HttpError(400, "Telegram bot token is required.");
  }

  return {
    botToken: auth.botToken,
    botUserId: auth.botUserId,
    botUserName: auth.botUserName,
  };
}

function toBotApiChatId(telegramChannelId: string): string {
  return `-100${telegramChannelId}`;
}

const BOT_COMMANDS: TelegramBotCommand[] = [
  {
    command: "model",
    description: "이 topic에 사용할 model 선택",
  },
  {
    command: "model_reasoning_effort",
    description: "이 topic의 reasoning effort 선택",
  },
  {
    command: "plan",
    description: "이 메시지를 plan mode로 실행",
  },
];

export function getThreadQueueSnapshot(threadId: number): {
  running: boolean;
  queueDepth: number;
  mode: "default" | "plan" | null;
} {
  const state = threadQueueStates.get(threadId);
  return {
    running: Boolean(state?.running),
    queueDepth: state?.queueDepth ?? 0,
    mode: state?.mode ?? null,
  };
}

export function getStoredThreadCodexConfig(thread: ThreadRecord): {
  effectiveModel: string;
  effectiveReasoningEffort: string;
} {
  const globalSettings = getCodexSettings();
  return {
    effectiveModel: thread.codexModelOverride || globalSettings.defaultModel || "",
    effectiveReasoningEffort:
      thread.codexReasoningEffortOverride || globalSettings.defaultReasoningEffort || "",
  };
}

function combineDeveloperInstructions(...chunks: Array<string | null | undefined>): string | null {
  const parts = chunks
    .map((chunk) => chunk?.trim() || "")
    .filter(Boolean);

  return parts.length ? parts.join("\n\n") : null;
}

function buildCronActionDeveloperInstruction(thread: ThreadRecord): string {
  const threadCronJobs = listCronJobsByThread(thread.id);
  const cronJobContext = threadCronJobs.length
    ? threadCronJobs
        .map(
          (job) =>
            `- {"jobId":${job.id},"name":${JSON.stringify(job.name)},"cronExpr":${JSON.stringify(job.cronExpr)},"enabled":${job.enabled},"timezone":${JSON.stringify(job.timezone)}}`,
        )
        .join("\n")
    : "- 현재 thread에 등록된 cron job이 없습니다.";

  return [
    "스케줄러/cron job 관련 요청 처리 규칙:",
    "- 사용자가 명시적으로 반복 실행, 예약 실행, cron, 매일/매주/몇 분마다 같은 스케줄 생성 의도를 말한 경우에만 cron action block을 출력한다.",
    "- 일정이나 수행할 작업이 모호하면 cron action block을 절대 출력하지 말고, 필요한 정보를 묻는 자연어 답변만 출력한다.",
    "- cron action block은 사용자에게 보이는 자연어 답변과 분리해 아래 형식으로만 출력한다.",
    `<${CRON_ACTION_TAG}>`,
    '{"version":1,"jobs":[{"op":"create","name":"...","cronExpr":"0 6 * * *","timezone":"Asia/Seoul","prompt":"..."},{"op":"delete","jobId":123}]}',
    `</${CRON_ACTION_TAG}>`,
    "- op는 create 또는 delete만 사용한다.",
    "- delete는 prompt, cronExpr, timezone을 넣지 않는다.",
    "- delete는 아래 현재 thread cron job 목록의 jobId를 우선 사용하고, jobId를 모르면 정확한 name을 사용한다.",
    "- 삭제 대상이 모호하면 action block을 출력하지 말고 어떤 cron job을 지울지 먼저 확인한다.",
    "- cronExpr는 반드시 5-field 형식(minute hour day month weekday)만 사용한다.",
    "- timezone은 비어 있으면 Asia/Seoul로 채운다.",
    "현재 thread에 등록된 cron job 목록:",
    cronJobContext,
    "- 자연어 답변에는 위 태그 이름을 설명하거나 노출하지 않는다.",
  ].join("\n");
}

function buildCronExecutionDeveloperInstruction(): string {
  return [
    "이 실행은 예약된 cron job이다.",
    "반드시 JSON 객체 하나만 출력한다. 코드펜스, 설명문, 여분 텍스트는 금지한다.",
    '형식: {"notify":true,"message":"...","summary":"..."}',
    "- notify=true 는 사용자에게 thread 메시지를 보내야 할 결과가 있을 때만 사용한다.",
    "- 변화가 없거나 알림이 필요 없으면 notify=false, message는 빈 문자열로 둔다.",
    "- summary에는 내부 요약을 짧게 넣는다.",
  ].join("\n");
}

function normalizeCronExpression(value: unknown): string {
  const normalized = assertNonEmptyString(value, "Cron expression").replace(/\s+/g, " ");
  if (normalized.split(" ").length !== 5) {
    throw new HttpError(400, "Cron expression must contain exactly 5 fields.");
  }

  const validation = CronTime.validateCronExpression(normalized);
  if (!validation.valid) {
    throw new HttpError(400, validation.error?.message || "Invalid cron expression.");
  }

  return normalized;
}

function normalizeCronTimezone(value: unknown): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_CRON_TIMEZONE;

  try {
    new CronTime("* * * * *", timezone);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? `Invalid cron timezone: ${error.message}` : "Invalid cron timezone.",
    );
  }

  return timezone;
}

function computeCronNextRunAt(cronExpr: string, timezone: string): string {
  try {
    return new CronTime(cronExpr, timezone).sendAt().toJSDate().toISOString();
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? `Failed to compute next cron run: ${error.message}` : "Failed to compute next cron run.",
    );
  }
}

function getScheduledCronJobNextRunAt(job: ScheduledCronJob | undefined): string | null {
  if (!job) {
    return null;
  }

  try {
    return job.nextDate().toJSDate().toISOString();
  } catch {
    return null;
  }
}

function buildCronActionFallbackText(input: {
  createdJobs: CronJobRecord[];
  deletedJobs: CronJobRecord[];
}): string {
  const { createdJobs, deletedJobs } = input;
  if (!createdJobs.length && !deletedJobs.length) {
    return "";
  }

  if (createdJobs.length === 1 && !deletedJobs.length) {
    return `cron job "${createdJobs[0].name}"을 생성했습니다.`;
  }

  if (deletedJobs.length === 1 && !createdJobs.length) {
    return `cron job "${deletedJobs[0].name}"을 삭제했습니다.`;
  }

  const summaries: string[] = [];
  if (createdJobs.length) {
    summaries.push(`생성 ${createdJobs.length}개`);
  }
  if (deletedJobs.length) {
    summaries.push(`삭제 ${deletedJobs.length}개`);
  }

  return `cron job ${summaries.join(", ")}를 처리했습니다.`;
}

function buildCronSystemErrorText(errorMessage: string): string {
  return `Cron job 처리 실패: ${errorMessage}`;
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() || trimmed;
}

function parseCronExecutionResponse(rawOutput: string): ParsedCronExecutionResponse {
  const normalized = stripJsonCodeFence(rawOutput);
  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch (error) {
    throw new CodexExecutionError(
      error instanceof Error ? `Cron JSON 응답 파싱에 실패했습니다: ${error.message}` : "Cron JSON 응답 파싱에 실패했습니다.",
    );
  }

  if (typeof parsed !== "object" || !parsed) {
    throw new CodexExecutionError("Cron JSON 응답이 객체가 아닙니다.");
  }

  const record = parsed as { notify?: unknown; message?: unknown; summary?: unknown };
  return {
    notify: Boolean(record.notify),
    message: typeof record.message === "string" ? record.message.trim() : "",
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
  };
}

function parseOptionalCronJobId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  throw new HttpError(400, "Cron job jobId must be a positive integer.");
}

function normalizeCronJobActionName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function parseCronActionJob(rawJob: RawCronActionJob): ParsedCronAction {
  if (rawJob?.op === "create") {
    return {
      op: "create",
      name: assertNonEmptyString(rawJob.name, "Cron job name"),
      prompt: assertNonEmptyString(rawJob.prompt, "Cron job prompt"),
      cronExpr: normalizeCronExpression(rawJob.cronExpr),
      timezone: normalizeCronTimezone(rawJob.timezone),
    };
  }

  if (rawJob?.op === "delete") {
    const jobId = parseOptionalCronJobId(rawJob.jobId ?? rawJob.id);
    const name = normalizeCronJobActionName(rawJob.name);
    if (jobId === null && !name) {
      throw new HttpError(400, "Cron job delete action requires jobId or name.");
    }

    return {
      op: "delete",
      jobId,
      name,
    };
  }

  throw new HttpError(400, "Unsupported cron action op.");
}

function extractCronActionsFromOutput(output: string): {
  visibleText: string;
  actions: ParsedCronAction[];
  errorMessage: string | null;
} {
  const rawBlocks: string[] = [];
  const visibleText = output
    .replace(CRON_ACTION_BLOCK_PATTERN, (_match, block) => {
      rawBlocks.push(String(block || "").trim());
      return "";
    })
    .trim();

  if (!rawBlocks.length) {
    return {
      visibleText,
      actions: [],
      errorMessage: null,
    };
  }

  try {
    const actions: ParsedCronAction[] = [];

    for (const rawBlock of rawBlocks) {
      const parsed = JSON.parse(rawBlock) as CronActionPayload;
      if (parsed.version !== 1) {
        throw new HttpError(400, "Unsupported cron action payload version.");
      }

      for (const rawJob of parsed.jobs || []) {
        actions.push(parseCronActionJob(rawJob));
      }
    }

    return {
      visibleText,
      actions,
      errorMessage: null,
    };
  } catch (error) {
    return {
      visibleText,
      actions: [],
      errorMessage: normalizeErrorMessage(error),
    };
  }
}

export function stopScheduledCronJob(jobId: number): void {
  const existing = scheduledCronJobs.get(jobId);
  if (!existing) {
    return;
  }

  scheduledCronJobs.delete(jobId);
  void existing.stop();
}

function scheduleCronJob(job: CronJobRecord): CronJobRecord {
  stopScheduledCronJob(job.id);

  const scheduledJob = ScheduledCronJob.from({
    cronTime: job.cronExpr,
    start: false,
    timeZone: job.timezone,
    name: `cron-job-${job.id}`,
    onTick: () => {
      void executeScheduledCronJob(job.id);
    },
    errorHandler: (error) => {
      console.error("Scheduled cron job callback failed:", {
        jobId: job.id,
        error,
      });
    },
  });

  scheduledJob.start();
  scheduledCronJobs.set(job.id, scheduledJob);
  return refreshCronJobNextRunAt(job.id, {
    nextRunAt: getScheduledCronJobNextRunAt(scheduledJob),
  }) || job;
}

export function syncCronJobSchedule(job: CronJobRecord): CronJobRecord {
  if (!job.enabled) {
    stopScheduledCronJob(job.id);
    return refreshCronJobNextRunAt(job.id, { nextRunAt: null }) || job;
  }

  return scheduleCronJob(job);
}

function resolveCronJobForDeletion(
  threadId: number,
  action: Extract<ParsedCronAction, { op: "delete" }>,
): CronJobRecord {
  const jobs = listCronJobsByThread(threadId);

  if (action.jobId !== null) {
    const job = jobs.find((entry) => entry.id === action.jobId);
    if (!job) {
      throw new HttpError(404, `Cron job ${action.jobId} not found in this thread.`);
    }
    if (action.name && action.name !== job.name) {
      throw new HttpError(400, `Cron job ${action.jobId} does not match name "${action.name}".`);
    }
    return job;
  }

  const matches = jobs.filter((entry) => entry.name === action.name);
  if (!matches.length) {
    throw new HttpError(404, `Cron job "${action.name}" not found in this thread.`);
  }
  if (matches.length > 1) {
    throw new HttpError(400, `Cron job name "${action.name}" is ambiguous in this thread.`);
  }

  return matches[0];
}

function deleteCronJobForThread(
  thread: ThreadRecord,
  action: Extract<ParsedCronAction, { op: "delete" }>,
): CronJobRecord {
  const job = resolveCronJobForDeletion(thread.id, action);
  stopScheduledCronJob(job.id);
  if (!deleteCronJobRecord(job.id)) {
    throw new HttpError(404, "Cron job not found.");
  }

  broadcastWorkspaceUpdated({
    projectId: thread.projectId,
    threadId: thread.id,
  });
  return job;
}

function recoverStaleCronJobRuns(): void {
  for (const run of getRunningCronJobRuns()) {
    finishCronJobRun(run.id, {
      status: "failed",
      finishedAt: nowIso(),
      errorText: "Server restarted before the cron job completed.",
    });
    const job = getCronJobById(run.cronJobId);
    if (job) {
      refreshCronJobNextRunAt(job.id, {
        lastRunAt: run.startedAt || nowIso(),
        lastRunStatus: "failed",
      });
    }
  }
}

export function loadCronSchedules(): void {
  recoverStaleCronJobRuns();

  for (const job of listCronJobs()) {
    if (job.enabled) {
      syncCronJobSchedule(job);
    } else {
      refreshCronJobNextRunAt(job.id, { nextRunAt: null });
    }
  }
}

export function stopAllCronSchedules(): void {
  for (const jobId of scheduledCronJobs.keys()) {
    stopScheduledCronJob(jobId);
  }
}

export function createCronJobForThread(input: {
  thread: ThreadRecord;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone?: string;
}): CronJobRecord {
  const cronExpr = normalizeCronExpression(input.cronExpr);
  const timezone = normalizeCronTimezone(input.timezone);
  const createdJob = createCronJobRecord({
    threadId: input.thread.id,
    name: assertNonEmptyString(input.name, "Cron job name"),
    prompt: assertNonEmptyString(input.prompt, "Cron job prompt"),
    cronExpr,
    timezone,
    nextRunAt: computeCronNextRunAt(cronExpr, timezone),
  });

  const scheduledJob = syncCronJobSchedule(createdJob);
  broadcastWorkspaceUpdated({
    projectId: input.thread.projectId,
    threadId: input.thread.id,
  });
  return scheduledJob;
}

async function getConfigSelectOptions(): Promise<{
  responseLanguages: ConfigSelectOption[];
  defaultModels: ConfigSelectOption[];
}> {
  if (externalServicesDisabled) {
    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: [],
    };
  }

  try {
    const models = await loadVisibleCodexModels();

    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: models.map((model) => ({
        value: model.id,
        label:
          model.displayName === model.id
            ? `${model.id}${model.isDefault ? " [default]" : ""}`
            : `${model.displayName} (${model.id})${model.isDefault ? " [default]" : ""}`,
      })),
    };
  } catch (error) {
    console.error("Config select options failed to load:", error);
    return {
      responseLanguages: CONFIG_LANGUAGE_OPTIONS,
      defaultModels: [],
    };
  }
}

export async function getAppState(): Promise<AppBootstrap> {
  const auth = getTelegramAuth();
  const runtime = {
    appVersion: getAppVersion(),
    version: codexRuntimeVersion,
  };
  const projects = listProjectsTree().map((project) => ({
    ...project,
    threads: project.threads.map((thread) => {
      const queueState = getThreadQueueSnapshot(thread.id);
      const storedConfig = getStoredThreadCodexConfig(thread);

      return {
        ...thread,
        effectiveModel: storedConfig.effectiveModel,
        effectiveReasoningEffort: storedConfig.effectiveReasoningEffort,
        running: queueState.running,
        queueDepth: queueState.queueDepth,
        currentMode: queueState.mode,
      };
    }),
  }));

  return {
    setupComplete: isSetupComplete(),
    auth: {
      isAuthenticated: auth.isAuthenticated,
      phoneNumber: auth.phoneNumber,
      userName: auth.userName,
    },
    runtime,
    settings: getPublicSettings(),
    configOptions: await getConfigSelectOptions(),
    projects,
  };
}

export async function clearTelegramRuntimeState(): Promise<void> {
  if (telegramInboundClient && telegramInboundHandler) {
    telegramInboundClient.removeEventHandler(telegramInboundHandler, telegramIncomingMessageEvent);
  }

  telegramInboundClient = null;
  telegramInboundHandler = null;
  botCallbackConflictLogged = false;
  ignoredTelegramEchoes.clear();
  await shutdownMtprotoClients();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof TelegramMtprotoError || error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

function trimTelegramText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 3900) {
    return normalized;
  }

  return `${normalized.slice(0, 3880)}\n\n[truncated]`;
}

function buildCodexReplyText(output: string): string {
  return trimTelegramText(`Codex\n\n${output}`);
}

function buildCodexErrorNotice(errorMessage: string): string {
  return trimTelegramText(`Codex 오류\n\n${errorMessage}`);
}

function buildCodexProgressText(text: string): string {
  return trimTelegramText(`Codex 진행\n\n${text}`);
}

function buildCodexArtifactRecordText(artifact: CodexArtifact): string {
  const prefix = artifact.kind === "image" ? "Codex 이미지 첨부" : "Codex 첨부 파일";
  return artifact.filename ? `${prefix}: ${artifact.filename}` : prefix;
}

function sanitizeArtifactFilename(filename: string): string {
  const baseName = path.basename(filename || "artifact");
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return sanitized || "artifact";
}

function buildTelegramEchoKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function broadcastRealtimeEvent(event: RealtimeEvent): void {
  if (!websocketClients.size) {
    return;
  }

  const payload = JSON.stringify(event);
  for (const client of websocketClients) {
    if (client.readyState !== WebSocket.OPEN) {
      websocketClients.delete(client);
      continue;
    }

    client.send(payload);
  }
}

export function broadcastWorkspaceUpdated(details: {
  projectId?: number | null;
  threadId?: number | null;
} = {}): void {
  broadcastRealtimeEvent({
    type: "workspace-updated",
    projectId: details.projectId ?? null,
    threadId: details.threadId ?? null,
  });
}

export function broadcastThreadMessagesUpdated(threadId: number): void {
  broadcastRealtimeEvent({
    type: "thread-messages-updated",
    threadId,
  });
}

function broadcastThreadState(threadId: number, projectId?: number | null): void {
  broadcastThreadMessagesUpdated(threadId);
  broadcastWorkspaceUpdated({
    threadId,
    projectId: projectId ?? null,
  });
}

function broadcastThreadTurnState(threadId: number): void {
  const state = getThreadQueueSnapshot(threadId);
  broadcastRealtimeEvent({
    type: "thread-turn-state",
    threadId,
    running: state.running,
    queueDepth: state.queueDepth,
    mode: state.mode,
  });
}

function broadcastThreadStreamEvent(threadId: number, event: ThreadStreamRealtimeEvent): void {
  broadcastRealtimeEvent({
    type: "thread-stream-event",
    threadId,
    event,
  });
}

function updateThreadQueueState(
  threadId: number,
  updater: (current: ThreadQueueState) => ThreadQueueState,
): ThreadQueueState {
  const current = threadQueueStates.get(threadId) || {
    tail: Promise.resolve(),
    queueDepth: 0,
    running: false,
    mode: null,
  };
  const next = updater(current);
  threadQueueStates.set(threadId, next);
  broadcastThreadTurnState(threadId);
  broadcastWorkspaceUpdated({
    threadId,
  });
  return next;
}

async function enqueueThreadTask<T>(
  threadId: number,
  mode: "default" | "plan",
  task: () => Promise<T>,
): Promise<T> {
  const current = threadQueueStates.get(threadId) || {
    tail: Promise.resolve(),
    queueDepth: 0,
    running: false,
    mode: null,
  };
  const queuedDepth = current.queueDepth + 1;
  threadQueueStates.set(threadId, {
    ...current,
    queueDepth: queuedDepth,
  });
  broadcastThreadTurnState(threadId);
  broadcastWorkspaceUpdated({
    threadId,
  });

  const execute = async (): Promise<T> => {
    updateThreadQueueState(threadId, (state) => ({
      ...state,
      queueDepth: Math.max(state.queueDepth - 1, 0),
      running: true,
      mode,
    }));

    try {
      return await task();
    } finally {
      updateThreadQueueState(threadId, (state) => ({
        ...state,
        running: false,
        mode: null,
      }));
      broadcastThreadStreamEvent(threadId, {
        type: "clear",
      });
    }
  };

  const nextPromise = current.tail.then(execute, execute);
  threadQueueStates.set(threadId, {
    tail: nextPromise.then(
      () => undefined,
      () => undefined,
    ),
    queueDepth: queuedDepth,
    running: current.running,
    mode: current.mode,
  });

  return nextPromise;
}

let codexModelsCache:
  | {
      loadedAt: number;
      models: CodexModelRecord[];
    }
  | null = null;

async function loadVisibleCodexModels(force = false): Promise<CodexModelRecord[]> {
  const now = Date.now();
  if (!force && codexModelsCache && now - codexModelsCache.loadedAt < 60_000) {
    return codexModelsCache.models;
  }

  const models = (await listCodexModels()).filter((model) => !model.hidden);
  codexModelsCache = {
    loadedAt: now,
    models,
  };
  return models;
}

async function resolveEffectiveThreadCodexConfig(
  thread: ThreadRecord,
): Promise<{
  model: CodexModelRecord;
  reasoningEffort: string;
  developerInstructions: string | null;
}> {
  const settings = getCodexSettings();
  const models = await loadVisibleCodexModels();
  const selectedModelId = thread.codexModelOverride || settings.defaultModel;
  const fallbackModel = models.find((model) => model.isDefault) || models[0];
  const model =
    models.find((entry) => entry.id === selectedModelId || entry.model === selectedModelId) || fallbackModel;

  if (!model) {
    throw new CodexExecutionError("사용 가능한 Codex model을 찾지 못했습니다.");
  }

  const requestedEffort =
    thread.codexReasoningEffortOverride || settings.defaultReasoningEffort || model.defaultReasoningEffort;
  const reasoningEffort =
    model.supportedReasoningEfforts.includes(requestedEffort)
      ? requestedEffort
      : model.defaultReasoningEffort;

  return {
    model,
    reasoningEffort,
    developerInstructions: buildLanguageInstruction(settings.responseLanguage) || null,
  };
}

async function applyCronActionsFromAssistantOutput(input: {
  thread: ThreadRecord;
  output: string;
}): Promise<{
  assistantText: string;
}> {
  const extracted = extractCronActionsFromOutput(input.output);
  let assistantText = extracted.visibleText.trim();

  if (!extracted.actions.length && !extracted.errorMessage) {
    return {
      assistantText: assistantText || input.output.trim(),
    };
  }

  if (extracted.errorMessage) {
    createMessage({
      threadId: input.thread.id,
      role: "system",
      content: buildCronSystemErrorText(extracted.errorMessage),
      source: "cron",
      senderName: "System",
      errorText: extracted.errorMessage,
    });
    broadcastThreadState(input.thread.id, input.thread.projectId);

    return {
      assistantText: assistantText || "cron job 요청을 처리하지 못했습니다.",
    };
  }

  try {
    const createdJobs: CronJobRecord[] = [];
    const deletedJobs: CronJobRecord[] = [];

    for (const action of extracted.actions) {
      if (action.op === "create") {
        createdJobs.push(
          createCronJobForThread({
            thread: input.thread,
            name: action.name,
            prompt: action.prompt,
            cronExpr: action.cronExpr,
            timezone: action.timezone,
          }),
        );
        continue;
      }

      deletedJobs.push(deleteCronJobForThread(input.thread, action));
    }

    return {
      assistantText: assistantText || buildCronActionFallbackText({ createdJobs, deletedJobs }),
    };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    createMessage({
      threadId: input.thread.id,
      role: "system",
      content: buildCronSystemErrorText(errorMessage),
      source: "cron",
      senderName: "System",
      errorText: errorMessage,
    });
    broadcastThreadState(input.thread.id, input.thread.projectId);

    return {
      assistantText: assistantText || "cron job 요청을 처리하지 못했습니다.",
    };
  }
}

async function runCronJobTurn(input: {
  job: CronJobRecord;
  thread: ThreadRecord;
  project: ProjectRecord;
  runStartedAt: string;
  runId: number;
}): Promise<void> {
  const effectiveConfig = await resolveEffectiveThreadCodexConfig(input.thread);
  const cronExecutionThread: ThreadRecord = {
    ...input.thread,
    codexThreadId: input.job.codexThreadId,
  };

  let notifySent = false;
  let finishedStatus = "success";
  let errorText: string | null = null;

  try {
    const codexResult = await runCodexTurn({
      project: input.project,
      thread: cronExecutionThread,
      userMessage: [
        "이 메시지는 예약된 cron job 실행이다.",
        `실행 시각(UTC): ${input.runStartedAt}`,
        "",
        input.job.prompt,
      ].join("\n"),
      senderName: "Cron Job",
      source: "web",
      mode: "default",
      model: effectiveConfig.model.id,
      reasoningEffort: effectiveConfig.reasoningEffort,
      developerInstructions: combineDeveloperInstructions(
        effectiveConfig.developerInstructions,
        buildCronExecutionDeveloperInstruction(),
      ),
    });

    if (!input.job.codexThreadId || input.job.codexThreadId !== codexResult.runtimeThreadId) {
      updateCronJobCodexThreadId(input.job.id, codexResult.runtimeThreadId);
    }

    const parsed = parseCronExecutionResponse(codexResult.output);
    if (parsed.notify && parsed.message) {
      if (!input.project.connection?.telegramChatId || !input.project.connection.telegramAccessHash) {
        throw new HttpError(400, "Project Telegram connection is missing.");
      }

      const botConfig = getBotConfigOrThrow();
      const sentMessage = await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId: toBotApiChatId(input.project.connection.telegramChatId),
        topicId: input.thread.telegramTopicId,
        text: trimTelegramText(parsed.message),
      });

      notifySent = true;
      createMessage({
        threadId: input.thread.id,
        role: "assistant",
        content: parsed.message,
        source: "cron",
        senderName: botConfig.botUserName,
        telegramMessageId: sentMessage.telegramMessageId,
      });
      broadcastThreadState(input.thread.id, input.project.id);
    }
  } catch (error) {
    finishedStatus = "failed";
    errorText = normalizeErrorMessage(error);
    createMessage({
      threadId: input.thread.id,
      role: "system",
      content: `Cron 실행 실패: ${errorText}`,
      source: "cron",
      senderName: "System",
      errorText,
    });
    broadcastThreadState(input.thread.id, input.project.id);
  } finally {
    const finishedAt = nowIso();
    touchCronJobRunState(input.runId, {
      notifySent,
      errorText,
    });
    finishCronJobRun(input.runId, {
      status: finishedStatus,
      finishedAt,
      notifySent,
      errorText,
    });
    refreshCronJobNextRunAt(input.job.id, {
      lastRunAt: finishedAt,
      lastRunStatus: finishedStatus,
      nextRunAt: getScheduledCronJobNextRunAt(scheduledCronJobs.get(input.job.id)),
    });
    broadcastWorkspaceUpdated({
      projectId: input.project.id,
      threadId: input.thread.id,
    });
  }
}

async function executeScheduledCronJob(jobId: number): Promise<void> {
  const job = getCronJobById(jobId);
  if (!job || !job.enabled) {
    stopScheduledCronJob(jobId);
    return;
  }

  const thread = getThreadById(job.threadId);
  const project = thread ? getProjectById(thread.projectId) : null;
  if (!thread || !project) {
    stopScheduledCronJob(jobId);
    return;
  }

  if (activeCronJobRuns.has(jobId)) {
    const skippedAt = nowIso();
    createCronJobRun({
      cronJobId: jobId,
      status: "skipped",
      finishedAt: skippedAt,
      errorText: "Skipped because the previous run is still active.",
    });
    refreshCronJobNextRunAt(jobId, {
      lastRunAt: skippedAt,
      lastRunStatus: "skipped",
      nextRunAt: getScheduledCronJobNextRunAt(scheduledCronJobs.get(jobId)),
    });
    broadcastWorkspaceUpdated({
      projectId: project.id,
      threadId: thread.id,
    });
    return;
  }

  const startedAt = nowIso();
  const run = createCronJobRun({
    cronJobId: jobId,
    status: "running",
    startedAt,
  });

  activeCronJobRuns.add(jobId);
  broadcastWorkspaceUpdated({
    projectId: project.id,
    threadId: thread.id,
  });

  try {
    await enqueueThreadTask(thread.id, "default", async () => {
      await runCronJobTurn({
        job,
        thread,
        project,
        runStartedAt: startedAt,
        runId: run.id,
      });
    });
  } finally {
    activeCronJobRuns.delete(jobId);
    broadcastWorkspaceUpdated({
      projectId: project.id,
      threadId: thread.id,
    });
  }
}

function rememberIgnoredTelegramEcho(chatId: string, messageId: number): void {
  const key = buildTelegramEchoKey(chatId, messageId);
  ignoredTelegramEchoes.set(key, Date.now() + 30_000);
}

function isIgnoredTelegramEcho(chatId: string, messageId: number): boolean {
  const key = buildTelegramEchoKey(chatId, messageId);
  const expiresAt = ignoredTelegramEchoes.get(key);

  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= Date.now()) {
    ignoredTelegramEchoes.delete(key);
    return false;
  }

  return true;
}

function cleanupIgnoredTelegramEchoes(): void {
  const now = Date.now();
  for (const [key, expiresAt] of ignoredTelegramEchoes.entries()) {
    if (expiresAt <= now) {
      ignoredTelegramEchoes.delete(key);
    }
  }
}

function normalizeTelegramChannelId(chatId: string): string | null {
  if (!chatId) {
    return null;
  }

  if (chatId.startsWith("-100")) {
    return chatId.slice(4);
  }

  if (chatId.startsWith("-")) {
    return null;
  }

  return chatId;
}

function formatTelegramSenderName(sender: unknown): string {
  if (sender instanceof Api.User) {
    const parts = [sender.firstName, sender.lastName].filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }

    if (sender.username) {
      return `@${sender.username}`;
    }

    if (sender.phone) {
      return sender.phone;
    }
  }

  if (sender instanceof Api.Channel || sender instanceof Api.Chat) {
    return sender.title;
  }

  return "Telegram User";
}

function extractTelegramTopicId(message: Api.Message): number | null {
  if (message.action instanceof Api.MessageActionTopicCreate) {
    return message.id;
  }

  if (message.replyTo?.forumTopic) {
    return message.replyTo.replyToTopId ?? message.replyTo.replyToMsgId ?? null;
  }

  return null;
}

function startBotTypingLoop(input: {
  botToken: string;
  chatId: string;
  topicId: number;
}): () => void {
  const tick = () =>
    sendTopicTypingAsBot(input).catch(() => undefined);

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 4000);

  return () => {
    clearInterval(timer);
  };
}

async function loadCodexArtifactBuffer(artifact: CodexArtifact): Promise<Buffer | null> {
  if (artifact.base64Data) {
    try {
      return Buffer.from(artifact.base64Data, "base64");
    } catch {
      return null;
    }
  }

  if (!artifact.filePath || !fs.existsSync(artifact.filePath)) {
    return null;
  }

  return fs.promises.readFile(artifact.filePath);
}

async function persistCodexArtifact(input: {
  threadId: number;
  artifact: CodexArtifact;
  buffer: Buffer;
}): Promise<{
  filename: string;
  mimeType: string;
  path: string;
}> {
  const threadDir = path.join(artifactsDir, String(input.threadId));
  await fs.promises.mkdir(threadDir, { recursive: true });

  const filename = sanitizeArtifactFilename(input.artifact.filename);
  const targetPath = path.join(
    threadDir,
    `${Date.now()}-${Math.random().toString(16).slice(2, 10)}-${filename}`,
  );

  await fs.promises.writeFile(targetPath, input.buffer);

  return {
    filename,
    mimeType: input.artifact.mimeType,
    path: targetPath,
  };
}

async function forwardCodexArtifactsToTelegram(input: {
  artifacts: CodexArtifact[];
  threadId: number;
  botToken: string;
  botUserName: string;
  chatId: string;
  topicId: number;
  replyToMessageId?: number | null;
}): Promise<void> {
  for (const artifact of input.artifacts) {
    const buffer = await loadCodexArtifactBuffer(artifact);
    if (!buffer) {
      continue;
    }

    const storedArtifact = await persistCodexArtifact({
      threadId: input.threadId,
      artifact,
      buffer,
    });

    const sentMessage =
      artifact.kind === "image"
        ? await sendTopicPhotoAsBot({
            botToken: input.botToken,
            chatId: input.chatId,
            topicId: input.topicId,
            photo: buffer,
            filename: storedArtifact.filename,
            mimeType: storedArtifact.mimeType,
            replyToMessageId: input.replyToMessageId ?? undefined,
          })
        : await sendTopicDocumentAsBot({
            botToken: input.botToken,
            chatId: input.chatId,
            topicId: input.topicId,
            document: buffer,
            filename: storedArtifact.filename,
            mimeType: storedArtifact.mimeType,
            replyToMessageId: input.replyToMessageId ?? undefined,
          });

    createMessage({
      threadId: input.threadId,
      role: "system",
      content: buildCodexArtifactRecordText(artifact),
      source: "codex",
      senderName: input.botUserName,
      telegramMessageId: sentMessage.telegramMessageId,
      attachmentKind: artifact.kind,
      attachmentPath: storedArtifact.path,
      attachmentMimeType: storedArtifact.mimeType,
      attachmentFilename: storedArtifact.filename,
    });

    broadcastThreadState(input.threadId);
  }
}

async function ensureThreadForTelegramTopic(input: {
  client: TelegramClient;
  project: ProjectRecord;
  topicId: number;
  initialTitle?: string | null;
}): Promise<ThreadRecord> {
  const existingThread = getThreadByProjectAndTelegramTopic(input.project.id, input.topicId);
  const connection = input.project.connection;

  if (!connection?.telegramChatId || !connection.telegramAccessHash) {
    throw new HttpError(400, "Project Telegram connection is missing.");
  }

  const lookedUpTopic =
    !input.initialTitle || existingThread?.telegramTopicName !== input.initialTitle
      ? await getForumTopicById(
          input.client,
          {
            telegramChatId: connection.telegramChatId,
            telegramAccessHash: connection.telegramAccessHash,
          },
          input.topicId,
        ).catch(() => null)
      : null;

  const nextTitle = lookedUpTopic?.title || input.initialTitle || `Topic ${input.topicId}`;

  if (existingThread) {
    if (existingThread.title !== nextTitle || existingThread.telegramTopicName !== nextTitle) {
      const updatedThread =
        updateThreadTopicMetadata(existingThread.id, {
          title: nextTitle,
          telegramTopicName: nextTitle,
        }) || existingThread;
      broadcastWorkspaceUpdated({
        projectId: input.project.id,
        threadId: updatedThread.id,
      });
      return updatedThread;
    }

    return existingThread;
  }

  try {
    const createdThread = createThread({
      projectId: input.project.id,
      title: nextTitle,
      telegramTopicId: input.topicId,
      telegramTopicName: nextTitle,
      origin: "telegram",
    });
    console.log("Telegram topic mapped to thread", {
      projectId: input.project.id,
      threadId: createdThread.id,
      topicId: input.topicId,
      title: nextTitle,
    });
    broadcastWorkspaceUpdated({
      projectId: input.project.id,
      threadId: createdThread.id,
    });
    return createdThread;
  } catch (error) {
    const recoveredThread = getThreadByProjectAndTelegramTopic(input.project.id, input.topicId);
    if (recoveredThread) {
      return recoveredThread;
    }

    throw error;
  }
}

async function maybeOpenBrowser(url: string): Promise<void> {
  if (process.env.AUTO_OPEN_BROWSER === "false" || process.env.CI) {
    return;
  }

  const command =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  try {
    await execAsync(command);
  } catch {
    // Ignore browser-open failures.
  }
}

function getAppVersion(): string {
  try {
    const packageJsonPath = resolveFromRepo("package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function execFileText(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: repoRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function execFileTextOrNull(command: string, args: string[]): Promise<string | null> {
  try {
    return await execFileText(command, args);
  } catch {
    return null;
  }
}

function getTrackedBranchName(mergeRef: string | null): string | null {
  if (!mergeRef) {
    return null;
  }

  return mergeRef.startsWith("refs/heads/") ? mergeRef.slice("refs/heads/".length) : mergeRef;
}

function parsePackageVersion(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
  } catch {
    return null;
  }
}

export async function getAppUpdateStatus(options: { fetchRemote: boolean }): Promise<AppUpdateStatus> {
  const checkedAt = nowIso();
  const currentVersion = getAppVersion();

  try {
    const insideWorkTree = await execFileText("git", ["rev-parse", "--is-inside-work-tree"]);
    if (insideWorkTree !== "true") {
      return {
        supported: false,
        currentVersion,
        latestVersion: null,
        currentBranch: null,
        upstreamBranch: null,
        currentCommit: null,
        latestCommit: null,
        dirty: false,
        updateAvailable: false,
        canApply: false,
        reason: "현재 작업 경로가 Git 저장소가 아니라 업데이트를 확인할 수 없습니다.",
        checkedAt,
      };
    }

    const currentBranch = (await execFileTextOrNull("git", ["branch", "--show-current"])) || null;
    const currentCommit = (await execFileTextOrNull("git", ["rev-parse", "--short", "HEAD"])) || null;
    const dirty = Boolean(await execFileTextOrNull("git", ["status", "--porcelain", "--untracked-files=normal"]));

    if (!currentBranch) {
      return {
        supported: false,
        currentVersion,
        latestVersion: null,
        currentBranch: null,
        upstreamBranch: null,
        currentCommit,
        latestCommit: null,
        dirty,
        updateAvailable: false,
        canApply: false,
        reason: "현재 체크아웃된 브랜치를 확인할 수 없습니다.",
        checkedAt,
      };
    }

    const remoteName = (await execFileTextOrNull("git", ["config", `branch.${currentBranch}.remote`])) || null;
    const trackedBranch = getTrackedBranchName(
      await execFileTextOrNull("git", ["config", `branch.${currentBranch}.merge`]),
    );

    if (!remoteName || !trackedBranch) {
      return {
        supported: false,
        currentVersion,
        latestVersion: null,
        currentBranch,
        upstreamBranch: null,
        currentCommit,
        latestCommit: null,
        dirty,
        updateAvailable: false,
        canApply: false,
        reason: "이 브랜치에 추적 원격이 설정되어 있지 않아 업데이트를 확인할 수 없습니다.",
        checkedAt,
      };
    }

    if (options.fetchRemote) {
      await execFileText("git", ["fetch", "--quiet", remoteName, trackedBranch]);
    }

    const upstreamBranch = `${remoteName}/${trackedBranch}`;
    const latestCommit = (await execFileTextOrNull("git", ["rev-parse", "--short", upstreamBranch])) || null;
    const latestVersion =
      parsePackageVersion(await execFileTextOrNull("git", ["show", `${upstreamBranch}:package.json`])) || currentVersion;
    const behindCount = Number((await execFileTextOrNull("git", ["rev-list", "--count", `HEAD..${upstreamBranch}`])) || "0");
    const updateAvailable = Number.isFinite(behindCount) && behindCount > 0;

    let reason = "이미 최신 버전입니다.";
    let canApply = false;

    if (dirty) {
      reason = "로컬 변경사항이 있어 자동 업데이트를 적용할 수 없습니다. 커밋하거나 정리한 뒤 다시 시도하세요.";
    } else if (updateAvailable) {
      reason =
        latestVersion && latestVersion !== currentVersion
          ? `v${latestVersion} 업데이트를 적용할 수 있습니다.`
          : "새 원격 커밋이 있어 업데이트를 적용할 수 있습니다.";
      canApply = true;
    }

    return {
      supported: true,
      currentVersion,
      latestVersion,
      currentBranch,
      upstreamBranch,
      currentCommit,
      latestCommit,
      dirty,
      updateAvailable,
      canApply,
      reason,
      checkedAt,
    };
  } catch (error) {
    return {
      supported: false,
      currentVersion,
      latestVersion: null,
      currentBranch: null,
      upstreamBranch: null,
      currentCommit: null,
      latestCommit: null,
      dirty: false,
      updateAvailable: false,
      canApply: false,
      reason: `업데이트 정보를 확인하지 못했습니다: ${normalizeErrorMessage(error)}`,
      checkedAt,
    };
  }
}

export async function applyAppUpdate(): Promise<AppUpdateApplyResult> {
  const status = await getAppUpdateStatus({ fetchRemote: true });

  if (!status.supported) {
    throw new HttpError(400, status.reason || "업데이트를 지원하지 않는 환경입니다.");
  }

  if (status.dirty) {
    throw new HttpError(409, status.reason || "로컬 변경사항이 있어 업데이트를 적용할 수 없습니다.");
  }

  if (!status.updateAvailable) {
    return {
      ...status,
      applied: false,
      dependenciesInstalled: false,
      buildExecuted: false,
      restartRequired: false,
    };
  }

  const currentBranch = status.currentBranch;
  if (!currentBranch) {
    throw new HttpError(400, "현재 브랜치를 확인할 수 없습니다.");
  }

  const remoteName = await execFileText("git", ["config", `branch.${currentBranch}.remote`]);
  const trackedBranch = getTrackedBranchName(await execFileText("git", ["config", `branch.${currentBranch}.merge`]));
  if (!trackedBranch) {
    throw new HttpError(400, "추적 브랜치 정보가 없어 업데이트를 적용할 수 없습니다.");
  }

  const previousHead = await execFileText("git", ["rev-parse", "HEAD"]);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  let pulled = false;

  try {
    await execFileText("git", ["pull", "--ff-only", remoteName, trackedBranch]);
    pulled = true;

    const nextHead = await execFileText("git", ["rev-parse", "HEAD"]);
    const changedFiles =
      previousHead === nextHead
        ? []
        : (await execFileText("git", ["diff", "--name-only", `${previousHead}..${nextHead}`]))
            .split("\n")
            .map((file) => file.trim())
            .filter(Boolean);

    let dependenciesInstalled = false;
    if (changedFiles.some((file) => file === "package.json" || file === "package-lock.json")) {
      await execAsync(`${npmCommand} install --no-fund --no-audit`, {
        cwd: repoRoot,
        maxBuffer: 8 * 1024 * 1024,
      });
      dependenciesInstalled = true;
    }

    await execAsync(`${npmCommand} run build`, {
      cwd: repoRoot,
      maxBuffer: 8 * 1024 * 1024,
    });

    const nextStatus = await getAppUpdateStatus({ fetchRemote: false });
    return {
      ...nextStatus,
      applied: previousHead !== nextHead,
      dependenciesInstalled,
      buildExecuted: true,
      restartRequired: true,
      reason:
        previousHead !== nextHead
          ? `v${nextStatus.currentVersion} 업데이트를 적용했습니다. 서버 재시작이 필요할 수 있습니다.`
          : "이미 최신 버전입니다.",
    };
  } catch (error) {
    if (pulled) {
      throw new HttpError(500, `업데이트 파일은 내려받았지만 후속 작업이 실패했습니다: ${normalizeErrorMessage(error)}`);
    }

    throw new HttpError(500, `업데이트 적용에 실패했습니다: ${normalizeErrorMessage(error)}`);
  }
}

type ParsedTelegramCommand =
  | {
      type: "model";
      argument: string;
      raw: string;
    }
  | {
      type: "model_reasoning_effort";
      argument: string;
      raw: string;
    }
  | {
      type: "plan";
      argument: string;
      raw: string;
    };

function buildPlanUpdateText(explanation: string | null | undefined, plan: CodexPlanStep[]): string {
  const lines: string[] = [];
  if (explanation?.trim()) {
    lines.push(explanation.trim());
  }

  if (plan.length) {
    if (lines.length) {
      lines.push("");
    }

    for (const step of plan) {
      lines.push(`- [${step.status}] ${step.step}`);
    }
  }

  return lines.join("\n").trim();
}

function parseTelegramCommand(text: string, botUserName: string): ParsedTelegramCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const commandMatch = trimmed.match(/^\/([a-zA-Z0-9_]+)(?:@([a-zA-Z0-9_]+))?(?:\s+([\s\S]*))?$/);
  if (!commandMatch) {
    return null;
  }

  const [, commandName, mentionedBot, argument = ""] = commandMatch;
  if (mentionedBot && mentionedBot.toLowerCase() !== botUserName.toLowerCase()) {
    return null;
  }

  if (commandName === "model") {
    return {
      type: "model",
      argument: argument.trim(),
      raw: trimmed,
    };
  }

  if (commandName === "model_reasoning_effort") {
    return {
      type: "model_reasoning_effort",
      argument: argument.trim().toLowerCase(),
      raw: trimmed,
    };
  }

  if (commandName === "plan") {
    return {
      type: "plan",
      argument: argument.trim(),
      raw: trimmed,
    };
  }

  return null;
}

function isOwnerTelegramUser(senderTelegramUserId: string | null): boolean {
  const auth = getTelegramAuth();
  return Boolean(senderTelegramUserId && auth.userId && senderTelegramUserId === auth.userId);
}

function recordTelegramControlMessage(input: {
  threadId: number;
  senderName: string;
  content: string;
  telegramMessageId?: number | null;
}): void {
  createMessage({
    threadId: input.threadId,
    role: "system",
    content: input.content,
    source: "telegram-command",
    senderName: input.senderName,
    telegramMessageId: input.telegramMessageId ?? null,
  });
}

function buildModelKeyboard(models: CodexModelRecord[]): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: models.map((model) => [
      {
        text: model.displayName,
        callback_data: `model|${model.id}`,
      },
    ]),
  };
}

function buildReasoningEffortKeyboard(
  model: CodexModelRecord,
): TelegramInlineKeyboardMarkup {
  const rows = model.supportedReasoningEfforts.map((effort) => [
    {
      text: effort,
      callback_data: `effort|${effort}`,
    },
  ]);

  rows.push([
    {
      text: "default",
      callback_data: "effort|default",
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

export async function syncScopedBotCommandsForProject(project: ProjectRecord): Promise<void> {
  const connection = project.connection;
  if (!connection?.telegramChatId) {
    return;
  }

  const botConfig = getBotConfigOrThrow();
  await setScopedBotCommands({
    botToken: botConfig.botToken,
    chatId: toBotApiChatId(connection.telegramChatId),
    commands: BOT_COMMANDS,
  });
}

export async function syncScopedBotCommandsForAllProjects(): Promise<void> {
  if (!isSetupComplete()) {
    return;
  }

  const projects = listProjectsTree();
  for (const project of projects) {
    try {
      await syncScopedBotCommandsForProject(project);
    } catch (error) {
      console.error("Bot command sync failed:", error);
    }
  }
}

function getBotCallbackOffset(): number {
  return Number(getSetting("telegram_bot_callback_offset") || 0) || 0;
}

function setBotCallbackOffset(offset: number): void {
  setSetting("telegram_bot_callback_offset", String(offset));
}

async function handleThreadModelSelection(input: {
  thread: ThreadRecord;
  selectedModelId: string | null;
}): Promise<{ updatedThread: ThreadRecord; confirmationText: string }> {
  const models = await loadVisibleCodexModels();
  if (!models.length) {
    throw new HttpError(400, "Codex model 목록을 불러오지 못했습니다.");
  }

  if (!input.selectedModelId) {
    const updatedThread = updateThreadCodexOverrides(input.thread.id, {
      codexModelOverride: null,
    });
    if (!updatedThread) {
      throw new HttpError(404, "Thread not found.");
    }

    return {
      updatedThread,
      confirmationText: "이 topic의 model override를 기본값으로 되돌렸습니다.",
    };
  }

  const model =
    models.find((entry) => entry.id === input.selectedModelId || entry.model === input.selectedModelId) || null;
  if (!model) {
    throw new HttpError(400, `지원하지 않는 model입니다: ${input.selectedModelId}`);
  }

  const updatedThread = updateThreadCodexOverrides(input.thread.id, {
    codexModelOverride: model.id,
  });
  if (!updatedThread) {
    throw new HttpError(404, "Thread not found.");
  }

  return {
    updatedThread,
    confirmationText: `이 topic의 model을 ${model.displayName}(${model.id})로 설정했습니다.`,
  };
}

async function handleThreadReasoningEffortSelection(input: {
  thread: ThreadRecord;
  selectedEffort: string | null;
}): Promise<{ updatedThread: ThreadRecord; confirmationText: string }> {
  const effectiveConfig = await resolveEffectiveThreadCodexConfig(input.thread);

  if (!input.selectedEffort) {
    const updatedThread = updateThreadCodexOverrides(input.thread.id, {
      codexReasoningEffortOverride: null,
    });
    if (!updatedThread) {
      throw new HttpError(404, "Thread not found.");
    }

    return {
      updatedThread,
      confirmationText: "이 topic의 reasoning effort override를 기본값으로 되돌렸습니다.",
    };
  }

  if (!effectiveConfig.model.supportedReasoningEfforts.includes(input.selectedEffort)) {
    throw new HttpError(
      400,
      `${effectiveConfig.model.id} model은 ${input.selectedEffort} reasoning effort를 지원하지 않습니다.`,
    );
  }

  const updatedThread = updateThreadCodexOverrides(input.thread.id, {
    codexReasoningEffortOverride: input.selectedEffort,
  });
  if (!updatedThread) {
    throw new HttpError(404, "Thread not found.");
  }

  return {
    updatedThread,
    confirmationText: `이 topic의 reasoning effort를 ${input.selectedEffort}로 설정했습니다.`,
  };
}

async function handleTelegramControlCommand(input: {
  command: ParsedTelegramCommand;
  project: ProjectRecord;
  thread: ThreadRecord;
  senderTelegramUserId: string | null;
  senderName: string;
  telegramMessageId: number;
}): Promise<{
  consumed: boolean;
  planInput?: string;
}> {
  const botConfig = getBotConfigOrThrow();
  const chatId = toBotApiChatId(input.project.connection!.telegramChatId!);

  if (!isOwnerTelegramUser(input.senderTelegramUserId)) {
    await sendTopicMessageAsBot({
      botToken: botConfig.botToken,
      chatId,
      topicId: input.thread.telegramTopicId,
      text: "이 명령은 로그인한 Telegram 사용자만 사용할 수 있습니다.",
      replyToMessageId: input.telegramMessageId,
    }).catch(() => undefined);
    return { consumed: true };
  }

  if (input.command.type === "plan") {
    if (!input.command.argument) {
      recordTelegramControlMessage({
        threadId: input.thread.id,
        senderName: input.senderName,
        content: input.command.raw,
      });
      broadcastThreadState(input.thread.id, input.project.id);
      await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId,
        topicId: input.thread.telegramTopicId,
        text: "사용법: /plan {message}",
        replyToMessageId: input.telegramMessageId,
      }).catch(() => undefined);
      return { consumed: true };
    }

    recordTelegramControlMessage({
      threadId: input.thread.id,
      senderName: input.senderName,
      content: `Plan mode 요청: ${input.command.argument}`,
    });
    broadcastThreadState(input.thread.id, input.project.id);

    return {
      consumed: false,
      planInput: input.command.argument,
    };
  }

  recordTelegramControlMessage({
    threadId: input.thread.id,
    senderName: input.senderName,
    content: input.command.raw,
    telegramMessageId: input.telegramMessageId,
  });
  broadcastThreadState(input.thread.id, input.project.id);

  if (input.command.type === "model") {
    if (!input.command.argument) {
      const models = await loadVisibleCodexModels();
      await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId,
        topicId: input.thread.telegramTopicId,
        text: "이 topic에 사용할 model을 선택하세요.",
        replyToMessageId: input.telegramMessageId,
        replyMarkup: buildModelKeyboard(models),
      });
      return { consumed: true };
    }

    const { updatedThread, confirmationText } = await handleThreadModelSelection({
      thread: input.thread,
      selectedModelId: input.command.argument === "default" ? null : input.command.argument,
    });
    broadcastWorkspaceUpdated({
      projectId: input.project.id,
      threadId: updatedThread.id,
    });
    await sendTopicMessageAsBot({
      botToken: botConfig.botToken,
      chatId,
      topicId: input.thread.telegramTopicId,
      text: confirmationText,
      replyToMessageId: input.telegramMessageId,
    }).catch(() => undefined);
    return { consumed: true };
  }

  if (input.command.type === "model_reasoning_effort") {
    if (!input.command.argument) {
      const effectiveConfig = await resolveEffectiveThreadCodexConfig(input.thread);
      await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId,
        topicId: input.thread.telegramTopicId,
        text: `${effectiveConfig.model.id} model에 적용할 reasoning effort를 선택하세요.`,
        replyToMessageId: input.telegramMessageId,
        replyMarkup: buildReasoningEffortKeyboard(effectiveConfig.model),
      });
      return { consumed: true };
    }

    const { updatedThread, confirmationText } = await handleThreadReasoningEffortSelection({
      thread: input.thread,
      selectedEffort: input.command.argument === "default" ? null : input.command.argument,
    });
    broadcastWorkspaceUpdated({
      projectId: input.project.id,
      threadId: updatedThread.id,
    });
    await sendTopicMessageAsBot({
      botToken: botConfig.botToken,
      chatId,
      topicId: input.thread.telegramTopicId,
      text: confirmationText,
      replyToMessageId: input.telegramMessageId,
    }).catch(() => undefined);
    return { consumed: true };
  }

  return { consumed: false };
}

async function handleBotCallbackUpdate(update: TelegramBotCallbackUpdate): Promise<void> {
  const callback = update.callbackQuery;
  if (!callback?.id || !callback.data || !callback.message?.chat?.id || !callback.message.message_id) {
    return;
  }

  const auth = getTelegramAuth();
  const botConfig = getBotConfigOrThrow();
  const senderTelegramUserId = String(callback.from.id);

  if (!auth.userId || senderTelegramUserId !== auth.userId) {
    await answerBotCallbackQuery({
      botToken: botConfig.botToken,
      callbackQueryId: callback.id,
      text: "로그인한 Telegram 사용자만 사용할 수 있습니다.",
      showAlert: true,
    }).catch(() => undefined);
    return;
  }

  const chatId = normalizeTelegramChannelId(String(callback.message.chat.id));
  const topicId = callback.message.message_thread_id || 0;
  if (!chatId || !topicId) {
    await answerBotCallbackQuery({
      botToken: botConfig.botToken,
      callbackQueryId: callback.id,
      text: "연결된 topic 정보를 찾지 못했습니다.",
      showAlert: true,
    }).catch(() => undefined);
    return;
  }

  const project = getProjectByTelegramChatId(chatId);
  const thread = project ? getThreadByProjectAndTelegramTopic(project.id, topicId) : null;
  if (!project || !thread) {
    await answerBotCallbackQuery({
      botToken: botConfig.botToken,
      callbackQueryId: callback.id,
      text: "연결된 thread를 찾지 못했습니다.",
      showAlert: true,
    }).catch(() => undefined);
    return;
  }

  const [action, value = ""] = callback.data.split("|");
  try {
    if (action === "model") {
      const result = await handleThreadModelSelection({
        thread,
        selectedModelId: value || null,
      });
      recordTelegramControlMessage({
        threadId: thread.id,
        senderName: auth.userName || "Telegram User",
        content: `model 설정: ${value || "default"}`,
      });
      broadcastThreadState(thread.id, project.id);
      broadcastWorkspaceUpdated({
        projectId: project.id,
        threadId: result.updatedThread.id,
      });

      await editTopicMessageTextAsBot({
        botToken: botConfig.botToken,
        chatId: String(callback.message.chat.id),
        messageId: callback.message.message_id,
        text: result.confirmationText,
      }).catch(() => undefined);
      await answerBotCallbackQuery({
        botToken: botConfig.botToken,
        callbackQueryId: callback.id,
        text: "model이 적용되었습니다.",
      }).catch(() => undefined);
      return;
    }

    if (action === "effort") {
      const result = await handleThreadReasoningEffortSelection({
        thread,
        selectedEffort: value === "default" ? null : value,
      });
      recordTelegramControlMessage({
        threadId: thread.id,
        senderName: auth.userName || "Telegram User",
        content: `reasoning effort 설정: ${value || "default"}`,
      });
      broadcastThreadState(thread.id, project.id);
      broadcastWorkspaceUpdated({
        projectId: project.id,
        threadId: result.updatedThread.id,
      });

      await editTopicMessageTextAsBot({
        botToken: botConfig.botToken,
        chatId: String(callback.message.chat.id),
        messageId: callback.message.message_id,
        text: result.confirmationText,
      }).catch(() => undefined);
      await answerBotCallbackQuery({
        botToken: botConfig.botToken,
        callbackQueryId: callback.id,
        text: "reasoning effort가 적용되었습니다.",
      }).catch(() => undefined);
    }
  } catch (error) {
    await answerBotCallbackQuery({
      botToken: botConfig.botToken,
      callbackQueryId: callback.id,
      text: normalizeErrorMessage(error),
      showAlert: true,
    }).catch(() => undefined);
  }
}

export async function ensureBotCallbackPolling(): Promise<void> {
  if (!isSetupComplete() || botCallbackPollingPromise || botCallbackPollingStopped) {
    return;
  }

  const pollingGeneration = botCallbackPollingGeneration;
  botCallbackPollingPromise = (async () => {
    while (!botCallbackPollingStopped && pollingGeneration === botCallbackPollingGeneration) {
      if (!isSetupComplete()) {
        break;
      }

      try {
        const botConfig = getBotConfigOrThrow();
        const updates = await getBotUpdates({
          botToken: botConfig.botToken,
          offset: getBotCallbackOffset(),
          timeoutSeconds: 20,
          allowedUpdates: ["callback_query"],
        });

        for (const update of updates) {
          setBotCallbackOffset(update.updateId + 1);
          await handleBotCallbackUpdate(update);
        }
      } catch (error) {
        if (
          error instanceof TelegramBotApiError &&
          error.message.includes("terminated by other getUpdates request")
        ) {
          if (!botCallbackConflictLogged) {
            botCallbackConflictLogged = true;
            console.error("Telegram bot callback polling paused:", error.message);
          }
          break;
        }

        if (!isSetupComplete() || pollingGeneration !== botCallbackPollingGeneration) {
          break;
        }

        console.error("Telegram bot callback polling failed:", error);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  })().finally(() => {
    botCallbackPollingPromise = null;

    if (
      !botCallbackPollingStopped &&
      pollingGeneration !== botCallbackPollingGeneration &&
      isSetupComplete()
    ) {
      void ensureBotCallbackPolling().catch((error) => {
        console.error("Telegram bot callback polling failed to restart:", error);
      });
    }
  });
}

export async function runConversationTurn(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  content: string;
  senderName: string;
  source: "telegram" | "web";
  mode?: "default" | "plan";
  senderTelegramUserId?: string | null;
  telegramMessageId?: number | null;
}): Promise<{
  thread: ThreadRecord;
}> {
  const authConfig = getAuthConfigOrThrow();
  const botConfig = getBotConfigOrThrow();
  const client = await getAuthenticatedClient(authConfig);

  if (!input.project.connection?.telegramChatId || !input.project.connection.telegramAccessHash) {
    throw new HttpError(400, "Project is not linked to a Telegram forum supergroup.");
  }

  const telegramConnection = {
    telegramChatId: input.project.connection.telegramChatId,
    telegramAccessHash: input.project.connection.telegramAccessHash,
  };
  let userTelegramMessageId = input.telegramMessageId ?? null;

  if (input.source === "web") {
    const sentUserMessage = await sendTopicMessage(
      client,
      telegramConnection,
      input.thread.telegramTopicId,
      trimTelegramText(input.content),
    );
    rememberIgnoredTelegramEcho(telegramConnection.telegramChatId, sentUserMessage.telegramMessageId);
    userTelegramMessageId = sentUserMessage.telegramMessageId;

    createMessage({
      threadId: input.thread.id,
      role: "user",
      content: input.content,
      source: "web",
      senderName: input.senderName,
      senderTelegramUserId: getTelegramAuth().userId,
      telegramMessageId: sentUserMessage.telegramMessageId,
    });
    broadcastThreadState(input.thread.id, input.project.id);
  } else {
    createMessage({
      threadId: input.thread.id,
      role: "user",
      content: input.content,
      source: "telegram",
      senderName: input.senderName,
      senderTelegramUserId: input.senderTelegramUserId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
    });
    broadcastThreadState(input.thread.id, input.project.id);
  }

  return enqueueThreadTask(input.thread.id, input.mode ?? "default", async () => {
    const latestThread = getThreadById(input.thread.id) || input.thread;
    const effectiveConfig = await resolveEffectiveThreadCodexConfig(latestThread);
    let lastProgressText = "";
    let lastPlanText = "";
    const stopTyping = startBotTypingLoop({
      botToken: botConfig.botToken,
      chatId: toBotApiChatId(telegramConnection.telegramChatId),
      topicId: latestThread.telegramTopicId,
    });

    try {
      const codexResult = await runCodexTurn({
        project: input.project,
        thread: latestThread,
        userMessage: input.content,
        senderName: input.senderName,
        source: input.source,
        mode: input.mode ?? "default",
        model: effectiveConfig.model.id,
        reasoningEffort: effectiveConfig.reasoningEffort,
        developerInstructions: combineDeveloperInstructions(
          effectiveConfig.developerInstructions,
          buildCronActionDeveloperInstruction(latestThread),
        ),
        onEvent: async (event: CodexTurnEvent) => {
          broadcastThreadStreamEvent(latestThread.id, {
            type: event.type,
            text: event.text,
            phase: event.phase ?? null,
            explanation: event.explanation ?? null,
            plan: event.plan,
          });

          if (!userTelegramMessageId) {
            return;
          }

          if (event.type === "reasoning-complete" || (event.type === "assistant-complete" && event.phase !== "final_answer")) {
            const progressText = event.text?.trim() || "";
            if (!progressText || progressText === lastProgressText) {
              return;
            }

            lastProgressText = progressText;
            const progressMessage = await sendTopicMessageAsBot({
              botToken: botConfig.botToken,
              chatId: toBotApiChatId(telegramConnection.telegramChatId),
              topicId: latestThread.telegramTopicId,
              text: buildCodexProgressText(progressText),
              replyToMessageId: userTelegramMessageId,
            });

            createMessage({
              threadId: latestThread.id,
              role: "system",
              content: `Codex 진행: ${progressText}`,
              source: "codex",
              senderName: botConfig.botUserName,
              telegramMessageId: progressMessage.telegramMessageId,
            });
            broadcastThreadState(latestThread.id, latestThread.projectId);
            return;
          }

          if (event.type === "plan-updated") {
            const planText = buildPlanUpdateText(event.explanation, event.plan || []);
            if (!planText || planText === lastPlanText) {
              return;
            }

            lastPlanText = planText;
            const planMessage = await sendTopicMessageAsBot({
              botToken: botConfig.botToken,
              chatId: toBotApiChatId(telegramConnection.telegramChatId),
              topicId: latestThread.telegramTopicId,
              text: buildCodexProgressText(planText),
              replyToMessageId: userTelegramMessageId,
            });

            createMessage({
              threadId: latestThread.id,
              role: "system",
              content: `Codex plan\n\n${planText}`,
              source: "codex",
              senderName: botConfig.botUserName,
              telegramMessageId: planMessage.telegramMessageId,
            });
            broadcastThreadState(latestThread.id, latestThread.projectId);
          }
        },
      });

      const updatedThread =
        !latestThread.codexThreadId || latestThread.codexThreadId !== codexResult.runtimeThreadId
          ? (updateThreadCodexThreadId(latestThread.id, codexResult.runtimeThreadId) ?? latestThread)
          : latestThread;
      const processedOutput = await applyCronActionsFromAssistantOutput({
        thread: updatedThread,
        output: codexResult.output,
      });
      const assistantText = processedOutput.assistantText.trim() || codexResult.output.trim();

      const botAssistantMessage = await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId: toBotApiChatId(telegramConnection.telegramChatId),
        topicId: updatedThread.telegramTopicId,
        text: buildCodexReplyText(assistantText),
        replyToMessageId: userTelegramMessageId ?? undefined,
      });

      createMessage({
        threadId: updatedThread.id,
        role: "assistant",
        content: assistantText,
        source: "codex",
        senderName: botConfig.botUserName,
        telegramMessageId: botAssistantMessage.telegramMessageId,
      });
      broadcastThreadState(updatedThread.id, updatedThread.projectId);

      try {
        await forwardCodexArtifactsToTelegram({
          artifacts: codexResult.artifacts,
          threadId: updatedThread.id,
          botToken: botConfig.botToken,
          botUserName: botConfig.botUserName,
          chatId: toBotApiChatId(telegramConnection.telegramChatId),
          topicId: updatedThread.telegramTopicId,
          replyToMessageId: userTelegramMessageId,
        });
      } catch (error) {
        console.error("Codex artifact forward failed:", error);
      }

      return {
        thread: updatedThread,
      };
    } catch (error) {
      const errorMessage = normalizeErrorMessage(error);

      createMessage({
        threadId: latestThread.id,
        role: "system",
        content: `Codex 실행 실패: ${errorMessage}`,
        source: "system",
        senderName: "System",
        errorText: errorMessage,
      });
      broadcastThreadState(latestThread.id, latestThread.projectId);

      await sendTopicMessageAsBot({
        botToken: botConfig.botToken,
        chatId: toBotApiChatId(telegramConnection.telegramChatId),
        topicId: latestThread.telegramTopicId,
        text: buildCodexErrorNotice(errorMessage),
        replyToMessageId: userTelegramMessageId ?? undefined,
      }).catch(() => undefined);

      throw error;
    } finally {
      stopTyping();
    }
  });
}

async function handleIncomingTelegramMessage(event: NewMessageEvent): Promise<void> {
  const auth = getTelegramAuth();
  if (!auth.isAuthenticated || !auth.userId || !auth.botUserId || !auth.botUserName) {
    return;
  }

  cleanupIgnoredTelegramEchoes();
  const message = event.message;
  const chatId = normalizeTelegramChannelId(message.chatId?.toString() || "");
  if (!chatId) {
    return;
  }

  if (isIgnoredTelegramEcho(chatId, message.id)) {
    return;
  }

  const project = getProjectByTelegramChatId(chatId);
  if (!project?.connection?.telegramChatId || !project.connection.telegramAccessHash) {
    return;
  }

  const senderId = message.senderId?.toString() || null;
  if (senderId && senderId === auth.botUserId) {
    return;
  }

  const topicId = extractTelegramTopicId(message);
  if (!topicId) {
    return;
  }

  const client = await getAuthenticatedClient(getAuthConfigOrThrow());
  const topicThread = await ensureThreadForTelegramTopic({
    client,
    project,
    topicId,
    initialTitle:
      message.action instanceof Api.MessageActionTopicCreate ? message.action.title : null,
  });

  await markTopicRead(
    client,
    {
      telegramChatId: project.connection.telegramChatId,
      telegramAccessHash: project.connection.telegramAccessHash,
    },
    topicId,
    message.id,
  ).catch((error) => {
    console.error("Telegram topic read failed:", error);
  });
  await message.markAsRead().catch((error) => {
    console.error("Telegram message markAsRead failed:", error);
  });

  if (findMessageByTelegramMessageId(topicThread.id, message.id)) {
    return;
  }

  if (message.action instanceof Api.MessageActionTopicCreate) {
    return;
  }

  const content = message.message.trim();
  if (!content) {
    return;
  }

  const sender = await message.getSender().catch(() => undefined);
  const parsedCommand = parseTelegramCommand(content, auth.botUserName);
  console.log("Telegram inbound message received", {
    chatId,
    topicId,
    messageId: message.id,
    senderId,
  });
  if (parsedCommand) {
    const commandResult = await handleTelegramControlCommand({
      command: parsedCommand,
      project,
      thread: topicThread,
      senderTelegramUserId: senderId,
      senderName: formatTelegramSenderName(sender),
      telegramMessageId: message.id,
    });

    if (commandResult.consumed) {
      return;
    }

    await runConversationTurn({
      project,
      thread: topicThread,
      content: commandResult.planInput || content,
      senderName: formatTelegramSenderName(sender),
      source: "telegram",
      mode: "plan",
      senderTelegramUserId: senderId,
      telegramMessageId: message.id,
    });
    return;
  }

  await runConversationTurn({
    project,
    thread: topicThread,
    content,
    senderName: formatTelegramSenderName(sender),
    source: "telegram",
    senderTelegramUserId: senderId,
    telegramMessageId: message.id,
  });
}

export async function ensureTelegramInboundHandler(): Promise<void> {
  if (!isSetupComplete()) {
    return;
  }

  const client = await getAuthenticatedClient(getAuthConfigOrThrow());
  if (telegramInboundClient === client && telegramInboundHandler) {
    return;
  }

  if (telegramInboundClient && telegramInboundHandler) {
    telegramInboundClient.removeEventHandler(telegramInboundHandler, telegramIncomingMessageEvent);
  }

  telegramInboundHandler = async (event: NewMessageEvent) => {
    try {
      await handleIncomingTelegramMessage(event);
    } catch (error) {
      console.error("Telegram inbound handling failed:", error);
    }
  };

  client.addEventHandler(telegramInboundHandler, telegramIncomingMessageEvent);
  telegramInboundClient = client;
  console.log("Telegram inbound listener attached");
}

export async function resetInstanceState() {
  const settings = resetCodexSettings();
  botCallbackPollingGeneration += 1;
  clearTelegramAuth();
  clearSetting("telegram_bot_callback_offset");
  await clearTelegramRuntimeState();
  broadcastWorkspaceUpdated();
  return settings;
}

export async function prepareRuntime(): Promise<void> {
  if (externalServicesDisabled) {
    codexRuntimeVersion = null;
    return;
  }

  const runtimeInfo = await getCodexRuntimeInfo();
  codexRuntimeVersion = runtimeInfo.version;
}

export async function startBackgroundServices(url: string): Promise<void> {
  if (externalServicesDisabled) {
    return;
  }

  try {
    loadCronSchedules();
  } catch (error) {
    console.error("Cron scheduler failed to load:", error);
  }

  await ensureTelegramInboundHandler().catch((error) => {
    console.error("Telegram inbound listener failed to start:", error);
  });
  await ensureBotCallbackPolling().catch((error) => {
    console.error("Telegram bot callback polling failed to start:", error);
  });
  await syncScopedBotCommandsForAllProjects().catch((error) => {
    console.error("Telegram bot command sync failed to start:", error);
  });
  await maybeOpenBrowser(url);
}

export async function shutdownBackgroundServices(): Promise<void> {
  botCallbackPollingStopped = true;
  stopAllCronSchedules();
  await shutdownMtprotoClients().catch(() => undefined);
  await shutdownCodexRuntime().catch(() => undefined);
}

export function attachRealtimeServer(server: HttpServer): WebSocketServer {
  const wsServer = new WebSocketServer({
    server,
    path: "/ws",
  });

  wsServer.on("connection", (socket) => {
    websocketClients.add(socket);
    const connectedEvent: RealtimeEvent = { type: "connected" };
    socket.send(JSON.stringify(connectedEvent));

    socket.on("close", () => {
      websocketClients.delete(socket);
    });

    socket.on("error", () => {
      websocketClients.delete(socket);
    });
  });

  return wsServer;
}
