import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ComposerAttachmentRecord,
  TurnSummaryPayload,
  TurnUndoState,
  UserInputAnswers,
  UserInputQuestion,
  UserInputRequestPayload,
} from "@remote-codex/contracts";

import {
  answerCodexUserInputRequest,
  CodexExecutionError,
  interruptCodexTurn,
} from "../../codex";
import {
  createMessage,
  createMessageEvent,
  getCodexTurnRunById,
  getLatestCodexTurnRunForThread,
  markCodexTurnRunUndone,
  updateMessageEventPayload,
  type ProjectRecord,
  type ThreadRecord,
} from "../../db";
import { HttpError, assertNonEmptyString } from "../../lib/http";
import { repoRoot, resolveFromRepo } from "../../lib/paths";
import {
  captureProjectGitSnapshot,
  ensureProjectPath,
  parseGitNumstat,
  parseGitStatusEntries,
} from "./git-fs";
import { broadcastThreadState } from "./realtime";

const execFileAsync = promisify(execFile);

type PendingUserInputRequestState = {
  requestId: string;
  threadId: number;
  messageEventId: number;
  turnId: string | null;
  itemId: string | null;
  questions: UserInputQuestion[];
  status: UserInputRequestPayload["status"];
  submittedAnswers: UserInputAnswers | null;
};

const pendingUserInputRequests = new Map<string, PendingUserInputRequestState>();

function getAppVersion(): string {
  try {
    const packageJsonPath = resolveFromRepo("package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function execFileText(command: string, args: string[], cwd = repoRoot): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

async function execFileTextOrNull(command: string, args: string[], cwd = repoRoot): Promise<string | null> {
  try {
    return await execFileText(command, args, cwd);
  } catch {
    return null;
  }
}

function getNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function getUpdatePackageName(): string {
  return process.env.REMOTE_CODEX_PACKAGE_NAME?.trim() || "@everyground/remote-codex";
}

function getUpdateRegistry(): string | null {
  const value = process.env.REMOTE_CODEX_NPM_REGISTRY?.trim() || "";
  return value || null;
}

function buildNpmArgs(command: string[]): string[] {
  const registry = getUpdateRegistry();
  return registry ? [...command, "--registry", registry] : command;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

export async function getAppUpdateStatus(options: { fetchRemote: boolean }): Promise<{
  supported: boolean;
  source: "npm";
  packageName: string | null;
  registry: string | null;
  targetVersion: string | null;
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
}> {
  const checkedAt = new Date().toISOString();
  const currentVersion = getAppVersion();
  const packageName = getUpdatePackageName();
  const registry = getUpdateRegistry();

  const baseStatus = {
    supported: true,
    source: "npm" as const,
    packageName,
    registry,
    targetVersion: null,
    currentVersion,
    latestVersion: null,
    currentBranch: null,
    upstreamBranch: null,
    currentCommit: null,
    latestCommit: null,
    dirty: false,
    updateAvailable: false,
    canApply: false,
    reason: "이미 최신 버전입니다.",
    checkedAt,
  };

  if (!options.fetchRemote) {
    return {
      ...baseStatus,
      latestVersion: currentVersion,
      targetVersion: currentVersion,
    };
  }

  try {
    const latestVersion = (await execFileText(getNpmCommand(), buildNpmArgs(["view", packageName, "version"]))) || null;
    const updateAvailable = Boolean(latestVersion && latestVersion !== currentVersion);

    return {
      ...baseStatus,
      latestVersion: latestVersion || currentVersion,
      targetVersion: latestVersion || currentVersion,
      updateAvailable,
      canApply: updateAvailable,
      reason: updateAvailable
        ? `v${latestVersion} 업데이트를 적용할 수 있습니다.`
        : "이미 최신 버전입니다.",
    };
  } catch (error) {
    return {
      ...baseStatus,
      supported: false,
      reason: `npm 업데이트 정보를 확인하지 못했습니다: ${normalizeErrorMessage(error)}`,
    };
  }
}

export async function applyAppUpdate(): Promise<Awaited<ReturnType<typeof getAppUpdateStatus>> & {
  applied: boolean;
  dependenciesInstalled: boolean;
  buildExecuted: boolean;
  restartRequired: boolean;
}> {
  const status = await getAppUpdateStatus({ fetchRemote: true });

  if (!status.supported) {
    throw new HttpError(400, status.reason || "업데이트를 지원하지 않는 환경입니다.");
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

  try {
    const targetVersion = status.targetVersion || status.latestVersion;
    if (!targetVersion) {
      throw new HttpError(400, "대상 버전을 확인할 수 없습니다.");
    }

    await execFileText(getNpmCommand(), buildNpmArgs(["install", "-g", `${getUpdatePackageName()}@${targetVersion}`]));
    const nextStatus = await getAppUpdateStatus({ fetchRemote: false });
    return {
      ...nextStatus,
      latestVersion: status.latestVersion,
      targetVersion,
      updateAvailable: false,
      canApply: false,
      applied: true,
      dependenciesInstalled: false,
      buildExecuted: false,
      restartRequired: true,
      reason: `v${targetVersion} 업데이트를 설치했습니다. 서버 재시작이 필요합니다.`,
    };
  } catch (error) {
    throw new HttpError(500, `업데이트 적용에 실패했습니다: ${normalizeErrorMessage(error)}`);
  }
}

function buildUserInputRequestContent(questions: UserInputQuestion[]): string {
  if (!questions.length) {
    return "Codex가 선택을 요청했습니다.";
  }

  if (questions.length === 1) {
    return questions[0].question.trim() || questions[0].header.trim() || "Codex가 선택을 요청했습니다.";
  }

  return `Codex가 ${questions.length}개의 선택을 요청했습니다.`;
}

function buildUserInputRequestPayload(input: {
  requestId: string;
  turnId: string | null;
  itemId: string | null;
  status: UserInputRequestPayload["status"];
  questions: UserInputQuestion[];
  submittedAnswers: UserInputAnswers | null;
}): UserInputRequestPayload {
  return {
    requestId: input.requestId,
    turnId: input.turnId,
    itemId: input.itemId,
    status: input.status,
    questions: input.questions,
    submittedAnswers: input.submittedAnswers,
  };
}

function validateUserInputAnswers(questions: UserInputQuestion[], answers: UserInputAnswers): UserInputAnswers {
  const normalized: UserInputAnswers = {};

  questions.forEach((question, index) => {
    const answerRecord = answers[question.id];
    const values = Array.isArray(answerRecord?.answers)
      ? answerRecord.answers.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
      : [];

    if (!values.length) {
      throw new HttpError(400, `${question.header || question.question || `Question ${index + 1}`}의 선택값이 필요합니다.`);
    }

    const [selectedValue] = values;
    const optionLabels = question.options.map((option) => option.label);
    const isKnownOption = optionLabels.includes(selectedValue);

    if (!isKnownOption && !question.isOther) {
      throw new HttpError(400, "허용되지 않은 선택값입니다.");
    }

    normalized[question.id] = {
      answers: [selectedValue],
    };
  });

  return normalized;
}

export function registerPendingUserInputRequest(input: {
  thread: ThreadRecord;
  requestId: string;
  turnId: string | null;
  itemId: string | null;
  questions: UserInputQuestion[];
}): void {
  const existing = pendingUserInputRequests.get(input.requestId);
  if (existing) {
    pendingUserInputRequests.set(input.requestId, {
      ...existing,
      turnId: input.turnId,
      itemId: input.itemId,
      questions: input.questions,
      status: "pending",
      submittedAnswers: null,
    });
    const updatedEvent = updateMessageEventPayload(
      existing.messageEventId,
      {
        kind: "user_input_request",
        request: buildUserInputRequestPayload({
          requestId: input.requestId,
          turnId: input.turnId,
          itemId: input.itemId,
          status: "pending",
          questions: input.questions,
          submittedAnswers: null,
        }),
      },
    );
    if (updatedEvent) {
      broadcastThreadState(input.thread.id, input.thread.projectId);
    }
    return;
  }

  const messageEvent = createMessageEvent({
    threadId: input.thread.id,
    kind: "system_message",
    role: "system",
    content: buildUserInputRequestContent(input.questions),
    originChannel: "local-ui",
    originActor: "Codex",
    displayHints: {
      hideOrigin: true,
      accent: "default",
      localSenderName: "Codex",
      telegramSenderName: "Codex",
    },
    payload: {
      kind: "user_input_request",
      request: buildUserInputRequestPayload({
        requestId: input.requestId,
        turnId: input.turnId,
        itemId: input.itemId,
        status: "pending",
        questions: input.questions,
        submittedAnswers: null,
      }),
    },
  });

  pendingUserInputRequests.set(input.requestId, {
    requestId: input.requestId,
    threadId: input.thread.id,
    messageEventId: messageEvent.id,
    turnId: input.turnId,
    itemId: input.itemId,
    questions: input.questions,
    status: "pending",
    submittedAnswers: null,
  });
  broadcastThreadState(input.thread.id, input.thread.projectId);
}

export function resolvePendingUserInputRequest(
  requestId: string,
  status: UserInputRequestPayload["status"],
): void {
  const pendingRequest = pendingUserInputRequests.get(requestId);
  if (!pendingRequest) {
    return;
  }

  pendingRequest.status = status;
  const updatedEvent = updateMessageEventPayload(
    pendingRequest.messageEventId,
    {
      kind: "user_input_request",
      request: buildUserInputRequestPayload({
        requestId,
        turnId: pendingRequest.turnId,
        itemId: pendingRequest.itemId,
        status,
        questions: pendingRequest.questions,
        submittedAnswers: pendingRequest.submittedAnswers,
      }),
    },
  );

  if (status === "resolved") {
    pendingUserInputRequests.delete(requestId);
  } else {
    pendingUserInputRequests.set(requestId, pendingRequest);
  }

  if (updatedEvent) {
    broadcastThreadState(pendingRequest.threadId);
  }
}

export function clearPendingUserInputRequestsForThread(threadId: number): void {
  const requestIds = Array.from(pendingUserInputRequests.values())
    .filter((pendingRequest) => pendingRequest.threadId === threadId)
    .map((pendingRequest) => pendingRequest.requestId);

  requestIds.forEach((requestId) => {
    resolvePendingUserInputRequest(requestId, "resolved");
  });
}

export async function submitThreadUserInputRequest(input: {
  thread: ThreadRecord;
  requestId: string;
  answers: UserInputAnswers;
}): Promise<void> {
  const pendingRequest = pendingUserInputRequests.get(input.requestId);
  if (!pendingRequest || pendingRequest.threadId !== input.thread.id) {
    throw new HttpError(404, "선택 요청을 찾을 수 없습니다.");
  }

  if (pendingRequest.status !== "pending") {
    throw new HttpError(409, "이미 처리된 선택 요청입니다.");
  }

  const normalizedAnswers = validateUserInputAnswers(pendingRequest.questions, input.answers);
  pendingRequest.status = "submitted";
  pendingRequest.submittedAnswers = normalizedAnswers;
  pendingUserInputRequests.set(input.requestId, pendingRequest);
  resolvePendingUserInputRequest(input.requestId, "submitted");

  try {
    await answerCodexUserInputRequest({
      requestId: input.requestId,
      answers: normalizedAnswers,
    });
  } catch (error) {
    const restoredRequest = pendingUserInputRequests.get(input.requestId);
    if (restoredRequest) {
      restoredRequest.status = "pending";
      restoredRequest.submittedAnswers = null;
      pendingUserInputRequests.set(input.requestId, restoredRequest);
      resolvePendingUserInputRequest(input.requestId, "pending");
    }
    throw error;
  }
}

export async function interruptThreadTurn(input: {
  thread: ThreadRecord;
}): Promise<void> {
  try {
    await interruptCodexTurn({
      localThreadId: input.thread.id,
    });
  } catch (error) {
    if (error instanceof CodexExecutionError && error.message.includes("현재 중지할 Codex 작업이 없습니다.")) {
      throw new HttpError(409, error.message);
    }

    throw error;
  }
}

export function resolveComposerAttachments(project: ProjectRecord, rawAttachments: unknown): ComposerAttachmentRecord[] {
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  return rawAttachments.map((entry, index) => {
    const record = entry as Partial<ComposerAttachmentRecord> & { path?: unknown; name?: unknown };
    const attachmentPath = ensureProjectPath(
      project,
      assertNonEmptyString(record.path, `Attachment path #${index + 1}`),
      "Attachment path",
    );

    if (!fs.existsSync(attachmentPath)) {
      throw new HttpError(400, `Attachment file does not exist: ${attachmentPath}`);
    }
    if (!fs.statSync(attachmentPath).isFile()) {
      throw new HttpError(400, `Attachment path must be a file: ${attachmentPath}`);
    }

    return {
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : randomUUID(),
      name:
        typeof record.name === "string" && record.name.trim() ? record.name.trim() : path.basename(attachmentPath),
      path: attachmentPath,
      relativePath: path.relative(project.folderPath, attachmentPath),
      source: record.source === "uploaded-file" ? "uploaded-file" : "project-file",
      mimeType: typeof record.mimeType === "string" && record.mimeType.trim() ? record.mimeType.trim() : null,
    } satisfies ComposerAttachmentRecord;
  });
}

export function buildCodexUserMessage(content: string, attachments: ComposerAttachmentRecord[]): string {
  const trimmedContent = content.trim();
  if (!attachments.length) {
    return trimmedContent;
  }

  const lines: string[] = [];
  if (trimmedContent) {
    lines.push(trimmedContent);
    lines.push("");
  }
  lines.push("첨부 파일:");
  attachments.forEach((attachment) => {
    lines.push(`- ${attachment.relativePath || attachment.path} (${attachment.path})`);
  });
  lines.push("");
  lines.push("필요하면 위 경로의 파일을 직접 확인해서 작업하세요.");

  return lines.join("\n").trim();
}

export async function buildTurnSummary(input: {
  project: ProjectRecord;
  turnRunId: number;
  durationMs: number;
  startedSnapshot: Awaited<ReturnType<typeof captureProjectGitSnapshot>>;
  exploredFilesCount: number | null;
}): Promise<{
  summary: TurnSummaryPayload;
  branchAtEnd: string | null;
  repoStatusAfter: string | null;
  changedFiles: TurnSummaryPayload["changedFiles"];
  undoState: TurnUndoState;
}> {
  const endSnapshot = await captureProjectGitSnapshot(input.project);
  let changedFiles: TurnSummaryPayload["changedFiles"] = [];
  let undoState: TurnUndoState = "not_available";
  let note: string | null = null;

  if (!input.startedSnapshot.isRepo) {
    note = "Git 저장소가 아니라 변경 요약과 실행취소를 제공하지 않습니다.";
  } else if (!input.startedSnapshot.clean) {
    note = "turn 시작 시 worktree가 dirty여서 변경 요약과 실행취소를 제공하지 않습니다.";
  } else {
    const statusEntries = parseGitStatusEntries(endSnapshot.statusPorcelain);
    const numstat = parseGitNumstat(
      (await execFileTextOrNull("git", ["diff", "--numstat", "--find-renames", "HEAD"], input.project.folderPath)) || "",
    );

    changedFiles = statusEntries
      .map((entry) => {
        const stats = numstat.get(entry.path) || {
          insertions: null,
          deletions: null,
          statsExact: false,
        };

        return {
          path: entry.path,
          status: entry.status,
          insertions: stats.insertions,
          deletions: stats.deletions,
          isUntracked: entry.isUntracked,
          statsExact: stats.statsExact,
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path, "ko"));

    if (!changedFiles.length) {
      note = "이번 turn에서 Git 기준 변경 파일은 없습니다.";
    } else if (
      input.startedSnapshot.currentBranch &&
      endSnapshot.currentBranch &&
      input.startedSnapshot.currentBranch !== endSnapshot.currentBranch
    ) {
      undoState = "blocked";
      note = "turn 이후 branch가 변경되어 실행취소를 제공하지 않습니다.";
    } else {
      undoState = "available";
    }
  }

  return {
    summary: {
      turnRunId: input.turnRunId,
      durationMs: input.durationMs,
      changedFileCount: changedFiles.length,
      changedFiles,
      exploredFilesCount: input.exploredFilesCount && input.exploredFilesCount > 0 ? input.exploredFilesCount : null,
      undoAvailable: undoState === "available",
      undoState,
      branch: endSnapshot.currentBranch || input.startedSnapshot.currentBranch,
      repoCleanAtStart: input.startedSnapshot.clean,
      note,
    },
    branchAtEnd: endSnapshot.currentBranch,
    repoStatusAfter: endSnapshot.isRepo ? endSnapshot.statusPorcelain : null,
    changedFiles,
    undoState,
  };
}

export async function undoLatestCodexTurn(input: {
  thread: ThreadRecord;
  project: ProjectRecord;
  turnRunId: number;
}): Promise<void> {
  const turnRun = getCodexTurnRunById(input.turnRunId);
  if (!turnRun || turnRun.threadId !== input.thread.id) {
    throw new HttpError(404, "Turn summary not found.");
  }

  const latestTurn = getLatestCodexTurnRunForThread(input.thread.id);
  if (!latestTurn || latestTurn.id !== turnRun.id) {
    throw new HttpError(409, "가장 최근 Codex turn만 실행취소할 수 있습니다.");
  }

  if (turnRun.undoState !== "available") {
    throw new HttpError(409, "이 turn은 실행취소할 수 없습니다.");
  }

  const snapshot = await captureProjectGitSnapshot(input.project);
  if (!snapshot.isRepo) {
    throw new HttpError(409, "Git project에서만 실행취소를 지원합니다.");
  }

  const expectedBranch = turnRun.branchAtEnd || turnRun.branchAtStart || null;
  if (expectedBranch && snapshot.currentBranch !== expectedBranch) {
    throw new HttpError(409, "현재 branch가 달라 실행취소할 수 없습니다.");
  }

  if ((turnRun.repoStatusAfter || "") !== snapshot.statusPorcelain) {
    throw new HttpError(409, "turn 이후 worktree가 변경되어 실행취소할 수 없습니다.");
  }

  const trackedPaths = turnRun.changedFiles.filter((entry) => !entry.isUntracked).map((entry) => entry.path);
  const untrackedPaths = turnRun.changedFiles.filter((entry) => entry.isUntracked).map((entry) => entry.path);

  if (trackedPaths.length) {
    await execFileText(
      "git",
      ["restore", "--source=HEAD", "--worktree", "--staged", "--", ...trackedPaths],
      input.project.folderPath,
    );
  }

  if (untrackedPaths.length) {
    await execFileText("git", ["clean", "-f", "--", ...untrackedPaths], input.project.folderPath);
  }

  markCodexTurnRunUndone(turnRun.id);

  if (turnRun.summaryEventId) {
    updateMessageEventPayload(turnRun.summaryEventId, {
      kind: "turn_summary",
      summary: {
        turnRunId: turnRun.id,
        durationMs: turnRun.durationMs || 0,
        changedFileCount: turnRun.changedFiles.length,
        changedFiles: turnRun.changedFiles,
        exploredFilesCount: turnRun.exploredFilesCount,
        undoAvailable: false,
        undoState: "undone",
        branch: turnRun.branchAtEnd || turnRun.branchAtStart || null,
        repoCleanAtStart: turnRun.repoCleanAtStart,
        note: "실행취소됨",
      },
    });
  }

  createMessage({
    threadId: input.thread.id,
    role: "system",
    content: "최근 Codex 변경을 실행취소했습니다.",
    source: "system",
    senderName: "System",
  });
}
