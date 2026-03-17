import { CronJob as ScheduledCronJob, CronTime } from "cron";

import { runCodexTurn } from "../../codex";
import {
  createCronJob as createCronJobRecord,
  createCronJobRun,
  createMessage,
  deleteCronJob as deleteCronJobRecord,
  finishCronJobRun,
  getCronJobById,
  getProjectById,
  getRunningCronJobRuns,
  getThreadById,
  listCronJobs,
  nowIso,
  refreshCronJobNextRunAt,
  touchCronJobRunState,
  updateCronJobCodexThreadId,
  type CronJobRecord,
  type ProjectRecord,
  type ThreadRecord,
} from "../../db";
import { HttpError } from "../../lib/http";
import { sendTopicMessageAsBot } from "../../bot";
import {
  broadcastThreadState,
  broadcastWorkspaceUpdated,
  enqueueThreadTask,
} from "./realtime";
import {
  combineDeveloperInstructions,
  getBotConfigOrThrow,
  hasTelegramRuntime,
  normalizeErrorMessage,
  resolveEffectiveThreadCodexConfig,
  toBotApiChatId,
  trimTelegramText,
} from "./shared";

const DEFAULT_CRON_TIMEZONE = "Asia/Seoul";
const CRON_ACTION_TAG = "remote_codex_cron_actions";
const CRON_ACTION_BLOCK_PATTERN = new RegExp(
  `<${CRON_ACTION_TAG}>\\s*([\\s\\S]*?)\\s*</${CRON_ACTION_TAG}>`,
  "gi",
);

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

const scheduledCronJobs = new Map<number, ScheduledCronJob>();
const activeCronJobRuns = new Set<number>();

export function buildCronActionDeveloperInstruction(thread: ThreadRecord): string {
  return [
    "만약 사용자의 요청이 미래 시점의 작업 반복이나 예약 실행을 의도한다면 응답 본문 뒤에 cron action 블록을 추가하라.",
    `형식: <${CRON_ACTION_TAG}>{\"jobs\":[...]}</${CRON_ACTION_TAG}>`,
    "각 job은 op(create|delete), name, prompt, cronExpr, timezone 또는 jobId/name을 포함한다.",
    "cronExpr는 5-field standard cron expression(minute hour day-of-month month day-of-week) 이어야 한다.",
    "timezone은 IANA timezone 문자열을 사용한다. 기본값은 Asia/Seoul 이다.",
    "delete는 가능한 경우 기존 job 이름 또는 id를 사용한다.",
    `현재 thread 제목: ${thread.title}`,
    "cron action 블록 외의 본문은 사용자에게 보이는 일반 응답으로 유지한다.",
  ].join("\n");
}

function buildCronExecutionDeveloperInstruction(): string {
  return [
    "이 실행은 예약된 cron job 이다.",
    "필요한 작업을 수행한 뒤, 사용자에게 보낼 알림이 필요하면 JSON 형식의 응답을 평문으로 반환하라.",
    '형식: {"notify":true,"message":"...","summary":"..."}',
    "알림이 불필요하면 notify=false 와 summary만 반환할 수 있다.",
  ].join("\n");
}

function normalizeCronExpression(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Cron expression must be a string.");
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  const parts = normalized.split(" ");
  if (parts.length !== 5) {
    throw new HttpError(400, "Cron expression must contain 5 fields.");
  }

  try {
    new CronTime(normalized, DEFAULT_CRON_TIMEZONE);
  } catch (error) {
    throw new HttpError(400, `Invalid cron expression: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return normalized;
}

function normalizeCronTimezone(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  const timezone = normalized || DEFAULT_CRON_TIMEZONE;

  try {
    new CronTime("* * * * *", timezone);
  } catch (error) {
    throw new HttpError(400, `Invalid timezone: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return timezone;
}

function computeCronNextRunAt(cronExpr: string, timezone: string): string {
  const cronTime = new CronTime(cronExpr, timezone);
  const nextDate = cronTime.sendAt();
  return nextDate.toJSDate().toISOString();
}

function getScheduledCronJobNextRunAt(job: ScheduledCronJob | undefined): string | null {
  if (!job) {
    return null;
  }

  try {
    const nextDate = job.nextDate();
    return nextDate.toJSDate().toISOString();
  } catch {
    return null;
  }
}

function buildCronActionFallbackText(input: {
  createdJobs: CronJobRecord[];
  deletedJobs: CronJobRecord[];
}): string {
  const lines: string[] = [];
  if (input.createdJobs.length) {
    lines.push(`생성된 cron job: ${input.createdJobs.map((job) => job.name).join(", ")}`);
  }
  if (input.deletedJobs.length) {
    lines.push(`삭제된 cron job: ${input.deletedJobs.map((job) => job.name).join(", ")}`);
  }
  return lines.join("\n") || "cron job 요청을 처리했습니다.";
}

function buildCronSystemErrorText(errorMessage: string): string {
  return `Cron job 요청을 처리하지 못했습니다.\n\n${errorMessage}`;
}

function stripJsonCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseCronExecutionResponse(rawOutput: string): ParsedCronExecutionResponse {
  const normalized = stripJsonCodeFence(rawOutput);

  try {
    const parsed = JSON.parse(normalized) as Partial<ParsedCronExecutionResponse>;
    return {
      notify: parsed.notify === true,
      message: typeof parsed.message === "string" ? parsed.message.trim() : "",
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : normalized,
    };
  } catch {
    return {
      notify: false,
      message: "",
      summary: normalized,
    };
  }
}

function parseOptionalCronJobId(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeCronJobActionName(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function parseCronActionJob(rawJob: RawCronActionJob): ParsedCronAction {
  const op = typeof rawJob.op === "string" ? rawJob.op.trim().toLowerCase() : "";

  if (op === "create") {
    const name = typeof rawJob.name === "string" ? rawJob.name.trim() : "";
    const prompt = typeof rawJob.prompt === "string" ? rawJob.prompt.trim() : "";

    if (!name) {
      throw new HttpError(400, "Cron create action requires a name.");
    }
    if (!prompt) {
      throw new HttpError(400, "Cron create action requires a prompt.");
    }

    return {
      op: "create",
      name,
      prompt,
      cronExpr: normalizeCronExpression(rawJob.cronExpr),
      timezone: normalizeCronTimezone(rawJob.timezone),
    };
  }

  if (op === "delete") {
    return {
      op: "delete",
      jobId: parseOptionalCronJobId(rawJob.jobId ?? rawJob.id),
      name: normalizeCronJobActionName(rawJob.name),
    };
  }

  throw new HttpError(400, `Unsupported cron action op: ${String(rawJob.op ?? "")}`);
}

function extractCronActionsFromOutput(output: string): {
  visibleText: string;
  actions: ParsedCronAction[];
  errorMessage: string | null;
} {
  const matches = Array.from(output.matchAll(CRON_ACTION_BLOCK_PATTERN));
  if (!matches.length) {
    return {
      visibleText: output,
      actions: [],
      errorMessage: null,
    };
  }

  const visibleText = output.replace(CRON_ACTION_BLOCK_PATTERN, "").trim();
  const actions: ParsedCronAction[] = [];

  try {
    for (const match of matches) {
      const payloadText = stripJsonCodeFence(match[1] || "");
      const parsed = JSON.parse(payloadText) as CronActionPayload;
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      jobs.forEach((job) => {
        actions.push(parseCronActionJob(job));
      });
    }
  } catch (error) {
    return {
      visibleText,
      actions: [],
      errorMessage: error instanceof Error ? error.message : "Invalid cron action payload.",
    };
  }

  return {
    visibleText,
    actions,
    errorMessage: null,
  };
}

export function stopScheduledCronJob(jobId: number): void {
  const job = scheduledCronJobs.get(jobId);
  if (!job) {
    return;
  }

  job.stop();
  scheduledCronJobs.delete(jobId);
}

export function syncCronJobSchedule(job: CronJobRecord): CronJobRecord {
  stopScheduledCronJob(job.id);

  if (!job.enabled) {
    refreshCronJobNextRunAt(job.id, {
      nextRunAt: null,
    });
    return job;
  }

  const scheduledJob = new ScheduledCronJob(
    job.cronExpr,
    () => {
      void executeScheduledCronJob(job.id);
    },
    null,
    false,
    job.timezone,
  );
  scheduledJob.start();
  scheduledCronJobs.set(job.id, scheduledJob);

  return (
    refreshCronJobNextRunAt(job.id, {
      nextRunAt: getScheduledCronJobNextRunAt(scheduledJob),
    }) || job
  );
}

function resolveCronJobForDeletion(
  thread: ThreadRecord,
  action: Extract<ParsedCronAction, { op: "delete" }>,
): CronJobRecord {
  if (action.jobId) {
    const job = getCronJobById(action.jobId);
    if (!job || job.threadId !== thread.id) {
      throw new HttpError(404, `Cron job ${action.jobId} not found for this thread.`);
    }
    return job;
  }

  if (action.name) {
    const candidates = listCronJobs()
      .filter((job) => job.threadId === thread.id)
      .filter((job) => job.name.trim().toLowerCase() === action.name!.trim().toLowerCase());

    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  throw new HttpError(404, "삭제할 cron job을 찾지 못했습니다.");
}

function deleteCronJobForThread(
  thread: ThreadRecord,
  action: Extract<ParsedCronAction, { op: "delete" }>,
): CronJobRecord {
  const target = resolveCronJobForDeletion(thread, action);
  stopScheduledCronJob(target.id);
  if (!deleteCronJobRecord(target.id)) {
    throw new HttpError(500, "Cron job 삭제에 실패했습니다.");
  }
  return target;
}

function recoverStaleCronJobRuns(): void {
  const runningRuns = getRunningCronJobRuns();
  if (!runningRuns.length) {
    return;
  }

  const finishedAt = nowIso();
  runningRuns.forEach((run) => {
    touchCronJobRunState(run.id, {
      status: "failed",
      errorText: "Recovered after service restart.",
    });
    finishCronJobRun(run.id, {
      status: "failed",
      finishedAt,
      errorText: "Recovered after service restart.",
    });
  });
}

export function loadCronSchedules(): void {
  recoverStaleCronJobRuns();
  const jobs = listCronJobs();
  jobs.forEach((job) => {
    try {
      syncCronJobSchedule(job);
    } catch (error) {
      console.error("Failed to sync cron job schedule", { jobId: job.id, error });
    }
  });
}

export function stopAllCronSchedules(): void {
  Array.from(scheduledCronJobs.keys()).forEach((jobId) => {
    stopScheduledCronJob(jobId);
  });
}

export function createCronJobForThread(input: {
  thread: ThreadRecord;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone?: string;
}): CronJobRecord {
  const createdJob = createCronJobRecord({
    threadId: input.thread.id,
    name: input.name.trim(),
    prompt: input.prompt.trim(),
    cronExpr: normalizeCronExpression(input.cronExpr),
    timezone: normalizeCronTimezone(input.timezone),
  });

  const scheduledJob = syncCronJobSchedule(createdJob);
  broadcastWorkspaceUpdated({
    projectId: input.thread.projectId,
    threadId: input.thread.id,
  });
  return scheduledJob;
}

export async function applyCronActionsFromAssistantOutput(input: {
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
      permissionMode: effectiveConfig.permissionMode,
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
      const hasTelegramMirror = Boolean(
        hasTelegramRuntime() &&
          input.project.connection?.telegramChatId &&
          input.project.connection.telegramAccessHash &&
          input.thread.telegramBinding?.telegramTopicId,
      );
      const botConfig = hasTelegramMirror ? getBotConfigOrThrow() : null;
      const sentMessage =
        hasTelegramMirror && botConfig && input.thread.telegramBinding?.telegramTopicId
          ? await sendTopicMessageAsBot({
              botToken: botConfig.botToken,
              chatId: toBotApiChatId(input.project.connection!.telegramChatId!),
              topicId: input.thread.telegramBinding.telegramTopicId,
              text: trimTelegramText(parsed.message),
            }).catch(() => null)
          : null;

      notifySent = true;
      createMessage({
        threadId: input.thread.id,
        role: "assistant",
        content: parsed.message,
        source: "cron",
        senderName: botConfig?.botUserName || "Cron Job",
        telegramMessageId: sentMessage?.telegramMessageId ?? null,
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
