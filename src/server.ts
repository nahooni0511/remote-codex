import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import dotenv from "dotenv";
import express, { type Request, type Response } from "express";

import { CodexExecutionError, runCodexTurn } from "./codex";
import {
  createInitialSetup,
  createMessage,
  createProject,
  createThread,
  deleteThread,
  findMessageByTelegramMessageId,
  getBotToken,
  getProjectById,
  getProjectByTelegramChatId,
  getPublicSettings,
  getSetting,
  getThreadById,
  getThreadByProjectAndTelegramTopic,
  isSetupComplete,
  listMessagesByThread,
  listProjectsTree,
  saveProjectConnectionInput,
  setSetting,
  updateProject,
  updateThreadCodexSession,
  updateThreadTopicMetadata,
  updateVerifiedConnection,
  type ProjectRecord,
  type ThreadRecord,
} from "./db";
import {
  TelegramApiError,
  createTelegramForumTopic,
  getTelegramUpdates,
  sendTelegramTopicMessage,
  verifyTelegramConnection,
  type TelegramIncomingMessage,
  type TelegramUpdate,
} from "./telegram";

dotenv.config();

const execAsync = promisify(exec);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_POLL_INTERVAL_MS = Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 3000);
const DISCOVERY_POLL_INTERVAL_MS = 2000;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const publicDir = path.resolve(process.cwd(), "public");

let telegramWorkerTimer: NodeJS.Timeout | null = null;
let telegramWorkerRunning = false;
let telegramWorkerEnabled = false;
let telegramWorkerStatus: "idle" | "running" | "paused" = "idle";
let telegramWorkerError: string | null = null;

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
  label?: string;
};

type ChatDiscoveryMatch = {
  telegramChatId: string;
  telegramChatTitle: string;
  chatType: string;
  forumEnabled: boolean;
  foundAt: string;
  telegramMessageId: number;
};

type ChatDiscoverySession = {
  id: string;
  botToken: string;
  expectedText: string;
  startedAt: string;
  updatedAt: string;
  status: "listening" | "found" | "error" | "expired" | "stopped";
  error: string | null;
  lastUpdateId: number;
  matches: ChatDiscoveryMatch[];
  useMainWorker: boolean;
  timer: NodeJS.Timeout | null;
  running: boolean;
};

const chatDiscoverySessions = new Map<string, ChatDiscoverySession>();

app.use(express.json());
app.use(express.static(publicDir));

class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  return value.trim();
}

function parseNumericId(input: string): number {
  const numericValue = Number(input);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new HttpError(400, "Invalid numeric identifier.");
  }

  return numericValue;
}

function validateFolderPath(folderPath: string): void {
  if (!path.isAbsolute(folderPath)) {
    throw new HttpError(400, "Project folder path must be an absolute path.");
  }

  if (!fs.existsSync(folderPath)) {
    throw new HttpError(400, "Project folder path does not exist.");
  }

  if (!fs.statSync(folderPath).isDirectory()) {
    throw new HttpError(400, "Project folder path must point to a directory.");
  }
}

function normalizeExistingDirectoryPath(input: string): string {
  const resolvedPath = path.resolve(input);

  if (!fs.existsSync(resolvedPath)) {
    throw new HttpError(400, "Directory path does not exist.");
  }

  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new HttpError(400, "Selected path must be a directory.");
  }

  return resolvedPath;
}

function directoryHasChildren(targetPath: string): boolean {
  try {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function listDirectoryNodes(targetPath: string): FsNode[] {
  const resolvedPath = normalizeExistingDirectoryPath(targetPath);

  try {
    const entries = fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name, "ko"));

    return entries.slice(0, 300).map((entry) => {
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

function getFilesystemRoots(): FsNode[] {
  const rootCandidates = [
    { label: "현재 작업공간", path: process.cwd() },
    { label: "홈 디렉토리", path: process.env.HOME || process.cwd() },
    { label: "루트", path: path.parse(process.cwd()).root },
  ];
  const seenPaths = new Set<string>();

  return rootCandidates
    .map((candidate) => ({
      label: candidate.label,
      path: normalizeExistingDirectoryPath(candidate.path),
    }))
    .filter((candidate) => {
      if (seenPaths.has(candidate.path)) {
        return false;
      }

      seenPaths.add(candidate.path);
      return true;
    })
    .map((candidate) => ({
      name: path.basename(candidate.path) || candidate.path,
      path: candidate.path,
      label: candidate.label,
      hasChildren: directoryHasChildren(candidate.path),
    }));
}

function getAppState() {
  return {
    setupComplete: isSetupComplete(),
    settings: {
      ...getPublicSettings(),
      telegramLastUpdateId: Number(getSetting("telegram_last_update_id") || 0),
      telegramPollingStatus: telegramWorkerStatus,
      telegramPollingError: telegramWorkerError,
    },
    projects: listProjectsTree(),
  };
}

function normalizeProjectPayload(body: Record<string, unknown>) {
  const folderPath = assertNonEmptyString(body.folderPath, "Project folder path");
  const telegramChatId =
    typeof body.telegramChatId === "string" && body.telegramChatId.trim()
      ? body.telegramChatId.trim()
      : null;

  validateFolderPath(folderPath);

  return {
    folderPath,
    telegramChatId,
  };
}

async function deriveProjectNameFromTelegram(
  telegramChatId: string | null,
): Promise<{
  projectName: string;
  verification: Awaited<ReturnType<typeof verifyTelegramConnection>> | null;
}> {
  if (!telegramChatId) {
    throw new HttpError(400, "Telegram supergroup chat ID is required.");
  }

  const botToken = getBotToken();
  if (!botToken) {
    throw new HttpError(400, "Telegram bot token is not configured.");
  }

  const verification = await verifyTelegramConnection(botToken, telegramChatId);
  const projectName = verification.telegramChatTitle?.trim() || verification.telegramChatId;

  return {
    projectName,
    verification,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof TelegramApiError || error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

function serializeChatDiscoverySession(session: ChatDiscoverySession) {
  return {
    id: session.id,
    expectedText: session.expectedText,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    status: session.status,
    error: session.error,
    useMainWorker: session.useMainWorker,
    matches: session.matches,
  };
}

function stopChatDiscoverySession(sessionId: string): void {
  const session = chatDiscoverySessions.get(sessionId);
  if (!session) {
    return;
  }

  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }

  if (session.status === "listening" || session.status === "found") {
    session.status = "stopped";
    session.updatedAt = new Date().toISOString();
  }
}

function maybeExpireChatDiscoverySession(session: ChatDiscoverySession): void {
  if (session.status === "error" || session.status === "expired" || session.status === "stopped") {
    return;
  }

  if (Date.now() - new Date(session.startedAt).getTime() >= DISCOVERY_TTL_MS) {
    session.status = "expired";
    session.updatedAt = new Date().toISOString();
    stopChatDiscoverySession(session.id);
  }
}

function maybeAddDiscoveryMatch(session: ChatDiscoverySession, message: TelegramIncomingMessage): void {
  const content = extractTelegramContent(message);
  if (!content || content.trim() !== session.expectedText) {
    return;
  }

  if (message.chat.type !== "supergroup") {
    return;
  }

  const alreadyMatched = session.matches.some(
    (match) => match.telegramChatId === String(message.chat.id),
  );
  if (alreadyMatched) {
    return;
  }

  session.matches.push({
    telegramChatId: String(message.chat.id),
    telegramChatTitle: message.chat.title || String(message.chat.id),
    chatType: message.chat.type,
    forumEnabled: Boolean(message.chat.is_forum),
    foundAt: new Date(message.date * 1000).toISOString(),
    telegramMessageId: message.message_id,
  });
  session.status = "found";
  session.updatedAt = new Date().toISOString();
}

function ingestChatDiscoveryMessage(botToken: string, message: TelegramIncomingMessage): void {
  for (const session of chatDiscoverySessions.values()) {
    if (session.botToken !== botToken) {
      continue;
    }

    maybeExpireChatDiscoverySession(session);
    if (session.status !== "listening" && session.status !== "found") {
      continue;
    }

    maybeAddDiscoveryMatch(session, message);
  }
}

async function createChatDiscoverySession(botToken: string): Promise<ChatDiscoverySession> {
  const now = new Date().toISOString();
  const configuredBotToken = getBotToken();
  const useMainWorker = Boolean(
    configuredBotToken &&
      configuredBotToken === botToken &&
      isSetupComplete() &&
      telegramWorkerEnabled &&
      telegramWorkerStatus === "running",
  );
  const session: ChatDiscoverySession = {
    id: randomUUID(),
    botToken,
    expectedText: "Hello World",
    startedAt: now,
    updatedAt: now,
    status: "listening",
    error: null,
    lastUpdateId: 0,
    matches: [],
    useMainWorker,
    timer: null,
    running: false,
  };

  if (!useMainWorker) {
    const seedUpdates = await getTelegramUpdates(botToken, 0);
    session.lastUpdateId = seedUpdates.reduce((max, update) => Math.max(max, update.update_id), 0);
  }

  chatDiscoverySessions.set(session.id, session);
  return session;
}

async function runChatDiscoveryTick(sessionId: string): Promise<void> {
  const session = chatDiscoverySessions.get(sessionId);
  if (!session) {
    return;
  }

  maybeExpireChatDiscoverySession(session);
  if (session.status === "expired" || session.status === "stopped" || session.useMainWorker || session.running) {
    return;
  }

  session.running = true;

  try {
    const updates = await getTelegramUpdates(session.botToken, session.lastUpdateId + 1);
    for (const update of updates) {
      session.lastUpdateId = Math.max(session.lastUpdateId, update.update_id);
      if (update.message) {
        maybeAddDiscoveryMatch(session, update.message);
      }
    }

    session.updatedAt = new Date().toISOString();
  } catch (error) {
    session.status = "error";
    session.error = normalizeErrorMessage(error);
    session.updatedAt = new Date().toISOString();
    stopChatDiscoverySession(session.id);
  } finally {
    session.running = false;
  }
}

function startActiveChatDiscoveryPolling(sessionId: string): void {
  const session = chatDiscoverySessions.get(sessionId);
  if (!session || session.useMainWorker || session.timer) {
    return;
  }

  session.timer = setInterval(() => {
    void runChatDiscoveryTick(sessionId);
  }, DISCOVERY_POLL_INTERVAL_MS);
}

function trimTelegramText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 3900) {
    return normalized;
  }

  return `${normalized.slice(0, 3880)}\n\n[truncated]`;
}

function buildWebMirrorMessage(content: string): string {
  return trimTelegramText(`웹 사용자 메시지\n\n${content}`);
}

function buildCodexErrorNotice(errorMessage: string): string {
  return trimTelegramText(`Codex 실행 실패\n\n${errorMessage}`);
}

function isTelegramTopicDeletedError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return (
    normalized.includes("message thread not found") ||
    normalized.includes("message thread was not found") ||
    normalized.includes("topic_deleted") ||
    normalized.includes("topic deleted")
  );
}

function removeThreadForDeletedTelegramTopic(input: {
  thread: ThreadRecord;
  reason: string;
}): never {
  deleteThread(input.thread.id);
  console.warn(
    `Deleted local thread ${input.thread.id} because Telegram topic ${input.thread.telegramTopicId} is gone: ${input.reason}`,
  );
  throw new HttpError(
    410,
    `Connected Telegram topic was deleted, so thread "${input.thread.title}" was removed. (${input.reason})`,
  );
}

function extractTelegramContent(message: TelegramIncomingMessage): string | null {
  const raw = message.text?.trim() || message.caption?.trim() || "";
  return raw || null;
}

function getTelegramTopicName(message: TelegramIncomingMessage): string | null {
  return (
    message.forum_topic_created?.name?.trim() ||
    message.reply_to_message?.forum_topic_created?.name?.trim() ||
    null
  );
}

function getTelegramSenderName(message: TelegramIncomingMessage): string {
  if (!message.from) {
    return "Telegram user";
  }

  if (message.from.username) {
    return `${message.from.first_name} (@${message.from.username})`;
  }

  return message.from.first_name;
}

function assertProjectHasTelegramConnection(project: ProjectRecord): string {
  if (!project.connection?.telegramChatId) {
    throw new HttpError(400, "Project is not linked to a Telegram supergroup.");
  }

  return project.connection.telegramChatId;
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
    // Ignore browser-open failures; the server is still usable.
  }
}

async function safeSendTopicText(input: {
  botToken: string;
  project: ProjectRecord;
  thread: ThreadRecord;
  text: string;
}): Promise<void> {
  try {
    await sendTelegramTopicMessage({
      botToken: input.botToken,
      telegramChatId: assertProjectHasTelegramConnection(input.project),
      telegramTopicId: input.thread.telegramTopicId,
      text: input.text,
    });
  } catch (error) {
    if (isTelegramTopicDeletedError(error)) {
      removeThreadForDeletedTelegramTopic({
        thread: input.thread,
        reason: normalizeErrorMessage(error),
      });
    }

    console.error("Failed to send Telegram topic message:", error);
  }
}

function ensureThreadForTelegramMessage(project: ProjectRecord, message: TelegramIncomingMessage): ThreadRecord {
  const topicId = message.message_thread_id;
  if (!topicId) {
    throw new HttpError(400, "Telegram topic message does not have a message_thread_id.");
  }

  const topicName = getTelegramTopicName(message);
  const existingThread = getThreadByProjectAndTelegramTopic(project.id, topicId);

  if (existingThread) {
    if (topicName && (existingThread.title !== topicName || existingThread.telegramTopicName !== topicName)) {
      return (
        updateThreadTopicMetadata(existingThread.id, {
          title: topicName,
          telegramTopicName: topicName,
        }) ?? existingThread
      );
    }

    return existingThread;
  }

  return createThread({
    projectId: project.id,
    title: topicName || `Telegram topic ${topicId}`,
    telegramTopicId: topicId,
    telegramTopicName: topicName,
    origin: "telegram",
  });
}

async function runConversationTurn(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  content: string;
  source: "telegram" | "web";
  senderName: string;
  senderTelegramUserId?: string | null;
  telegramMessageId?: number | null;
  mirrorUserMessageToTelegram?: boolean;
}) {
  const botToken = getBotToken();
  if (!botToken) {
    throw new HttpError(400, "Telegram bot token is not configured.");
  }

  const userMessage = createMessage({
    threadId: input.thread.id,
    role: "user",
    content: input.content,
    source: input.source,
    senderName: input.senderName,
    senderTelegramUserId: input.senderTelegramUserId ?? null,
    telegramMessageId: input.telegramMessageId ?? null,
  });

  if (input.source === "web" && input.mirrorUserMessageToTelegram) {
    await safeSendTopicText({
      botToken,
      project: input.project,
      thread: input.thread,
      text: buildWebMirrorMessage(input.content),
    });
  }

  try {
    const codexResult = await runCodexTurn({
      project: input.project,
      thread: input.thread,
      userMessage: input.content,
      senderName: input.senderName,
      source: input.source,
    });

    const updatedThread =
      !input.thread.codexSessionId || input.thread.codexSessionId !== codexResult.sessionId
        ? (updateThreadCodexSession(input.thread.id, codexResult.sessionId) ?? input.thread)
        : input.thread;

    const assistantMessage = createMessage({
      threadId: updatedThread.id,
      role: "assistant",
      content: codexResult.output,
      source: "codex",
      senderName: "Codex",
    });

    await safeSendTopicText({
      botToken,
      project: input.project,
      thread: updatedThread,
      text: trimTelegramText(codexResult.output),
    });

    return {
      thread: updatedThread,
      userMessage,
      assistantMessage,
    };
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 410) {
      throw error;
    }

    const errorMessage = normalizeErrorMessage(error);

    createMessage({
      threadId: input.thread.id,
      role: "system",
      content: `Codex 실행 실패: ${errorMessage}`,
      source: "system",
      senderName: "System",
      errorText: errorMessage,
    });

    await safeSendTopicText({
      botToken,
      project: input.project,
      thread: input.thread,
      text: buildCodexErrorNotice(errorMessage),
    });

    throw error;
  }
}

async function initializeThreadCodexSession(
  project: ProjectRecord,
  thread: ThreadRecord,
): Promise<ThreadRecord> {
  if (thread.codexSessionId) {
    return thread;
  }

  try {
    const result = await runCodexTurn({
      project,
      thread,
      userMessage:
        "이 Telegram topic용 Codex thread가 방금 생성되었다. 아직 실제 사용자 요청은 없다. 앞으로 이 세션을 유지하고 지금은 READY 한 단어만 답해.",
      senderName: "System",
      source: "web",
    });

    return updateThreadCodexSession(thread.id, result.sessionId) ?? thread;
  } catch (error) {
    createMessage({
      threadId: thread.id,
      role: "system",
      content: `Codex 세션 초기화 실패: ${normalizeErrorMessage(error)}`,
      source: "system",
      senderName: "System",
      errorText: normalizeErrorMessage(error),
    });

    return thread;
  }
}

async function processTelegramMessage(message: TelegramIncomingMessage): Promise<void> {
  if (message.chat.type !== "supergroup" || !message.message_thread_id) {
    return;
  }

  const project = getProjectByTelegramChatId(String(message.chat.id));
  if (!project) {
    return;
  }

  const thread = ensureThreadForTelegramMessage(project, message);
  const initializedThread =
    message.forum_topic_created && !thread.codexSessionId
      ? await initializeThreadCodexSession(project, thread)
      : thread;

  if (message.forum_topic_created && !findMessageByTelegramMessageId(initializedThread.id, message.message_id)) {
    createMessage({
      threadId: initializedThread.id,
      role: "system",
      content: `Telegram topic 생성: ${message.forum_topic_created.name}`,
      source: "telegram",
      senderName: "Telegram",
      telegramMessageId: message.message_id,
    });
  }

  if (!message.from || message.from.is_bot) {
    return;
  }

  const content = extractTelegramContent(message);
  if (!content) {
    return;
  }

  if (findMessageByTelegramMessageId(initializedThread.id, message.message_id)) {
    return;
  }

  await runConversationTurn({
    project,
    thread: initializedThread,
    content,
    source: "telegram",
    senderName: getTelegramSenderName(message),
    senderTelegramUserId: String(message.from.id),
    telegramMessageId: message.message_id,
  });
}

async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message) {
    await processTelegramMessage(update.message);
  }
}

async function runTelegramPollingTick(): Promise<void> {
  if (telegramWorkerRunning) {
    return;
  }

  if (!isSetupComplete()) {
    return;
  }

  const botToken = getBotToken();
  if (!botToken) {
    return;
  }

  telegramWorkerRunning = true;
  telegramWorkerStatus = "running";
  telegramWorkerError = null;

  try {
    const lastUpdateId = Number(getSetting("telegram_last_update_id") || 0);
    const updates = await getTelegramUpdates(botToken, lastUpdateId + 1);

    if (!updates.length) {
      return;
    }

    let maxUpdateId = lastUpdateId;

    for (const update of updates) {
      maxUpdateId = Math.max(maxUpdateId, update.update_id);

      try {
        if (update.message) {
          ingestChatDiscoveryMessage(botToken, update.message);
        }
        await processTelegramUpdate(update);
      } catch (error) {
        console.error(`Telegram update ${update.update_id} failed:`, error);
      }
    }

    setSetting("telegram_last_update_id", String(maxUpdateId));
  } catch (error) {
    if (error instanceof TelegramApiError && error.statusCode === 409) {
      telegramWorkerStatus = "paused";
      telegramWorkerError =
        "다른 프로세스가 같은 bot token으로 getUpdates를 사용 중입니다. 기존 polling 소비자를 중지한 뒤 서버를 다시 시작하세요.";
      telegramWorkerEnabled = false;
      stopTelegramWorker();
      return;
    }

    telegramWorkerStatus = "paused";
    telegramWorkerError = normalizeErrorMessage(error);
    throw error;
  } finally {
    telegramWorkerRunning = false;
  }
}

function scheduleTelegramWorker(): void {
  if (!telegramWorkerEnabled) {
    return;
  }

  if (telegramWorkerTimer) {
    clearTimeout(telegramWorkerTimer);
  }

  telegramWorkerTimer = setTimeout(async () => {
    await runTelegramPollingTick().catch((error) => {
      console.error("Telegram polling tick failed:", error);
    });

    if (telegramWorkerEnabled) {
      scheduleTelegramWorker();
    }
  }, TELEGRAM_POLL_INTERVAL_MS);
}

function startTelegramWorker(): void {
  telegramWorkerEnabled = true;
  telegramWorkerStatus = "running";
  telegramWorkerError = null;

  if (telegramWorkerTimer) {
    return;
  }

  scheduleTelegramWorker();
  void runTelegramPollingTick().catch((error) => {
    console.error("Telegram polling start failed:", error);
  });
}

function stopTelegramWorker(): void {
  telegramWorkerEnabled = false;
  if (telegramWorkerTimer) {
    clearTimeout(telegramWorkerTimer);
    telegramWorkerTimer = null;
  }

  if (!telegramWorkerRunning && telegramWorkerStatus !== "paused") {
    telegramWorkerStatus = "idle";
  }
}

app.get("/api/fs/roots", (_request, response, next) => {
  try {
    response.json({
      roots: getFilesystemRoots(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/fs/list", (request, response, next) => {
  try {
    const targetPath = assertNonEmptyString(request.query.path, "Directory path");
    response.json({
      path: normalizeExistingDirectoryPath(targetPath),
      entries: listDirectoryNodes(targetPath),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/chat-discovery/start", async (request, response, next) => {
  try {
    const botToken =
      typeof request.body.botToken === "string" && request.body.botToken.trim()
        ? request.body.botToken.trim()
        : getBotToken();

    if (!botToken) {
      throw new HttpError(400, "Telegram bot token is required.");
    }

    const session = await createChatDiscoverySession(botToken);
    startActiveChatDiscoveryPolling(session.id);

    response.status(201).json(serializeChatDiscoverySession(session));
  } catch (error) {
    next(error);
  }
});

app.get("/api/telegram/chat-discovery/:sessionId", (request, response, next) => {
  try {
    const session = chatDiscoverySessions.get(request.params.sessionId);
    if (!session) {
      throw new HttpError(404, "Chat discovery session not found.");
    }

    maybeExpireChatDiscoverySession(session);
    response.json(serializeChatDiscoverySession(session));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/telegram/chat-discovery/:sessionId", (request, response, next) => {
  try {
    stopChatDiscoverySession(request.params.sessionId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/telegram/verify-connection", async (request, response, next) => {
  try {
    const botToken =
      typeof request.body.botToken === "string" && request.body.botToken.trim()
        ? request.body.botToken.trim()
        : getBotToken();
    const telegramChatId = assertNonEmptyString(
      request.body.telegramChatId,
      "Telegram supergroup chat ID",
    );

    if (!botToken) {
      throw new HttpError(400, "Telegram bot token is required.");
    }

    const verification = await verifyTelegramConnection(botToken, telegramChatId);
    response.json({
      verification,
      derivedProjectName: verification.telegramChatTitle || verification.telegramChatId,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/bootstrap", (_request, response) => {
  response.json(getAppState());
});

app.post("/api/setup", async (request, response, next) => {
  try {
    if (isSetupComplete()) {
      throw new HttpError(409, "Setup is already complete.");
    }

    const appName = assertNonEmptyString(request.body.appName, "App name");
    const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");
    const firstProjectFolderPath = assertNonEmptyString(
      request.body.firstProjectFolderPath,
      "First project folder path",
    );
    const telegramChatId = assertNonEmptyString(
      request.body.telegramChatId,
      "Telegram supergroup chat ID",
    );

    validateFolderPath(firstProjectFolderPath);

    const verification = await verifyTelegramConnection(botToken, telegramChatId);

    if (!verification.forumEnabled) {
      throw new HttpError(400, "Telegram group is not configured as a forum supergroup.");
    }

    if (!verification.botJoined) {
      throw new HttpError(400, "Bot is not a member of the Telegram group.");
    }

    if (!verification.botIsAdmin) {
      throw new HttpError(400, "Bot must be an administrator in the Telegram group.");
    }

    if (!verification.canManageTopics) {
      throw new HttpError(400, "Bot must have the Manage Topics admin right.");
    }

    createInitialSetup({
      appName,
      botToken,
      firstProjectName: verification.telegramChatTitle || verification.telegramChatId,
      firstProjectFolderPath,
      telegramChatId: verification.telegramChatId,
      telegramChatTitle: verification.telegramChatTitle,
      forumEnabled: verification.forumEnabled,
      botJoined: verification.botJoined,
      botIsAdmin: verification.botIsAdmin,
      canManageTopics: verification.canManageTopics,
    });

    startTelegramWorker();

    response.status(201).json(getAppState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    if (!isSetupComplete()) {
      throw new HttpError(400, "Setup is required before creating projects.");
    }

    const payload = normalizeProjectPayload(request.body);
    const { projectName, verification } = await deriveProjectNameFromTelegram(payload.telegramChatId);
    const project = createProject({
      ...payload,
      name: projectName,
    });

    if (verification) {
      updateVerifiedConnection(project.id, {
        telegramChatId: verification.telegramChatId,
        telegramChatTitle: verification.telegramChatTitle,
        forumEnabled: verification.forumEnabled,
        botJoined: verification.botJoined,
        botIsAdmin: verification.botIsAdmin,
        canManageTopics: verification.canManageTopics,
        lastVerifiedAt: new Date().toISOString(),
      });
    }

    response.status(201).json(getProjectById(project.id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    response.json(project);
  } catch (error) {
    next(error);
  }
});

app.put("/api/projects/:projectId", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const payload = normalizeProjectPayload(request.body);
    const existingProject = getProjectById(projectId);

    if (!existingProject) {
      throw new HttpError(404, "Project not found.");
    }

    const { projectName, verification } = await deriveProjectNameFromTelegram(payload.telegramChatId);

    updateProject(projectId, {
      name: projectName,
      folderPath: payload.folderPath,
    });
    saveProjectConnectionInput(projectId, payload.telegramChatId);

    if (verification) {
      updateVerifiedConnection(projectId, {
        telegramChatId: verification.telegramChatId,
        telegramChatTitle: verification.telegramChatTitle,
        forumEnabled: verification.forumEnabled,
        botJoined: verification.botJoined,
        botIsAdmin: verification.botIsAdmin,
        canManageTopics: verification.canManageTopics,
        lastVerifiedAt: new Date().toISOString(),
      });
    }

    response.json(getProjectById(projectId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/telegram/verify", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);
    const botToken = getBotToken();

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    if (!botToken) {
      throw new HttpError(400, "Telegram bot token is not configured.");
    }

    const telegramChatId = assertNonEmptyString(
      request.body.telegramChatId,
      "Telegram supergroup chat ID",
    );

    const verification = await verifyTelegramConnection(botToken, telegramChatId);
    const updatedConnection = updateVerifiedConnection(projectId, {
      telegramChatId: verification.telegramChatId,
      telegramChatTitle: verification.telegramChatTitle,
      forumEnabled: verification.forumEnabled,
      botJoined: verification.botJoined,
      botIsAdmin: verification.botIsAdmin,
      canManageTopics: verification.canManageTopics,
      lastVerifiedAt: new Date().toISOString(),
    });

    response.json({
      projectId,
      verification,
      connection: updatedConnection,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/threads", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const title = assertNonEmptyString(request.body.title, "Thread title");
    const project = getProjectById(projectId);
    const botToken = getBotToken();

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    if (!botToken) {
      throw new HttpError(400, "Telegram bot token is not configured.");
    }

    if (!project.connection?.telegramChatId) {
      throw new HttpError(400, "Project is not linked to a Telegram supergroup.");
    }

    if (!project.connection.forumEnabled) {
      throw new HttpError(400, "Telegram group must be a forum supergroup.");
    }

    if (!project.connection.botIsAdmin || !project.connection.canManageTopics) {
      throw new HttpError(400, "Bot must be admin and have Manage Topics permission.");
    }

    const topic = await createTelegramForumTopic(botToken, project.connection.telegramChatId, title);
    let thread = createThread({
      projectId,
      title,
      telegramTopicId: topic.telegramTopicId,
      telegramTopicName: topic.title,
      origin: "app",
    });
    thread = await initializeThreadCodexSession(project, thread);

    response.status(201).json(thread);
  } catch (error) {
    next(error);
  }
});

app.get("/api/threads/:threadId/messages", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    response.json({
      thread,
      messages: listMessagesByThread(threadId),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/threads/:threadId/messages", async (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    const content = assertNonEmptyString(request.body.content, "Message content");

    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const project = getProjectById(thread.projectId);
    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const senderName =
      typeof request.body.role === "string" && request.body.role.trim()
        ? request.body.role.trim()
        : "Web user";

    const result = await runConversationTurn({
      project,
      thread,
      content,
      source: "web",
      senderName,
      mirrorUserMessageToTelegram: true,
    });

    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error instanceof TelegramApiError || error instanceof CodexExecutionError) {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server started at ${url}`);

  if (isSetupComplete()) {
    startTelegramWorker();
  }

  await maybeOpenBrowser(url);
});

process.on("SIGINT", () => {
  stopTelegramWorker();
  for (const sessionId of chatDiscoverySessions.keys()) {
    stopChatDiscoverySession(sessionId);
  }
});

process.on("SIGTERM", () => {
  stopTelegramWorker();
  for (const sessionId of chatDiscoverySessions.keys()) {
    stopChatDiscoverySession(sessionId);
  }
});
