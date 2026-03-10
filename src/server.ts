import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { WebSocketServer, WebSocket } from "ws";

import {
  getTelegramBotProfile,
  sendTopicDocumentAsBot,
  sendTopicMessageAsBot,
  sendTopicPhotoAsBot,
  sendTopicTypingAsBot,
  TelegramBotApiError,
} from "./bot";
import { CodexExecutionError, runCodexTurn, type CodexArtifact } from "./codex";
import {
  createMessage,
  createProject,
  createThread,
  deleteProject,
  deleteThread,
  findMessageByTelegramMessageId,
  getMessageAttachmentById,
  getProjectById,
  getProjectByTelegramChatId,
  getPublicSettings,
  getTelegramAuth,
  getThreadById,
  getThreadByProjectAndTelegramTopic,
  isSetupComplete,
  listMessagesByThread,
  listProjectsTree,
  saveProjectTelegramConnection,
  saveTelegramAuth,
  updateProject,
  updateThreadCodexSession,
  updateThreadTopicMetadata,
  type ProjectRecord,
  type ThreadRecord,
} from "./db";
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
} from "./mtproto";

dotenv.config();

const execAsync = promisify(exec);
const app = express();

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.resolve(process.cwd(), "public");
const artifactsDir = path.resolve(process.cwd(), "data", "artifacts");
const telegramIncomingMessageEvent = new NewMessage({});
const ignoredTelegramEchoes = new Map<string, number>();
const websocketClients = new Set<WebSocket>();

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
    };

type FsNode = {
  name: string;
  path: string;
  hasChildren: boolean;
};

let telegramInboundClient: TelegramClient | null = null;
let telegramInboundHandler:
  | ((event: NewMessageEvent) => Promise<void>)
  | null = null;

class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

app.use(express.json());
app.use(express.static(publicDir));

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

function validateFolderPath(folderPath: string): string {
  const resolved = path.resolve(folderPath);

  if (!path.isAbsolute(resolved)) {
    throw new HttpError(400, "Project folder path must be an absolute path.");
  }

  if (!fs.existsSync(resolved)) {
    throw new HttpError(400, "Project folder path does not exist.");
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new HttpError(400, "Project folder path must point to a directory.");
  }

  return resolved;
}

function normalizeExistingDirectoryPath(input?: string): string {
  const target = input?.trim() ? path.resolve(input) : path.parse(process.cwd()).root;

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

function listDirectoryNodes(targetPath: string): FsNode[] {
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

function getAuthConfigOrThrow(): TelegramAuthConfig {
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

function getBotConfigOrThrow(): { botToken: string; botUserId: string; botUserName: string } {
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

function getAppState() {
  const auth = getTelegramAuth();

  return {
    setupComplete: isSetupComplete(),
    auth: {
      isAuthenticated: auth.isAuthenticated,
      phoneNumber: auth.phoneNumber,
      userName: auth.userName,
    },
    settings: getPublicSettings(),
    projects: listProjectsTree(),
  };
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

function broadcastWorkspaceUpdated(details: {
  projectId?: number | null;
  threadId?: number | null;
} = {}): void {
  broadcastRealtimeEvent({
    type: "workspace-updated",
    projectId: details.projectId ?? null,
    threadId: details.threadId ?? null,
  });
}

function broadcastThreadMessagesUpdated(threadId: number): void {
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

async function runConversationTurn(input: {
  project: ProjectRecord;
  thread: ThreadRecord;
  content: string;
  senderName: string;
  source: "telegram" | "web";
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
  let lastProgressText = "";

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

  const stopTyping = startBotTypingLoop({
    botToken: botConfig.botToken,
    chatId: toBotApiChatId(telegramConnection.telegramChatId),
    topicId: input.thread.telegramTopicId,
  });

  try {
    const codexResult = await runCodexTurn({
      project: input.project,
      thread: input.thread,
      userMessage: input.content,
      senderName: input.senderName,
      source: input.source,
      onProgress: async (event) => {
        const progressText = event.text.trim();
        if (!progressText || progressText === lastProgressText || !userTelegramMessageId) {
          return;
        }

        lastProgressText = progressText;

        const progressMessage = await sendTopicMessageAsBot({
          botToken: botConfig.botToken,
          chatId: toBotApiChatId(telegramConnection.telegramChatId),
          topicId: input.thread.telegramTopicId,
          text: buildCodexProgressText(progressText),
          replyToMessageId: userTelegramMessageId,
        });

        createMessage({
          threadId: input.thread.id,
          role: "system",
          content: `Codex 진행: ${progressText}`,
          source: "codex",
          senderName: botConfig.botUserName,
          telegramMessageId: progressMessage.telegramMessageId,
        });
        broadcastThreadState(input.thread.id, input.project.id);
      },
    });

    const updatedThread =
      !input.thread.codexSessionId || input.thread.codexSessionId !== codexResult.sessionId
        ? (updateThreadCodexSession(input.thread.id, codexResult.sessionId) ?? input.thread)
        : input.thread;

    const botAssistantMessage = await sendTopicMessageAsBot({
      botToken: botConfig.botToken,
      chatId: toBotApiChatId(telegramConnection.telegramChatId),
      topicId: updatedThread.telegramTopicId,
      text: buildCodexReplyText(codexResult.output),
      replyToMessageId: userTelegramMessageId ?? undefined,
    });

    createMessage({
      threadId: updatedThread.id,
      role: "assistant",
      content: codexResult.output,
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
      threadId: input.thread.id,
      role: "system",
      content: `Codex 실행 실패: ${errorMessage}`,
      source: "system",
      senderName: "System",
      errorText: errorMessage,
    });
    broadcastThreadState(input.thread.id, input.project.id);

    await sendTopicMessageAsBot({
      botToken: botConfig.botToken,
      chatId: toBotApiChatId(telegramConnection.telegramChatId),
      topicId: input.thread.telegramTopicId,
      text: buildCodexErrorNotice(errorMessage),
      replyToMessageId: userTelegramMessageId ?? undefined,
    }).catch(() => undefined);

    throw error;
  } finally {
    stopTyping();
  }
}

async function handleIncomingTelegramMessage(event: NewMessageEvent): Promise<void> {
  const auth = getTelegramAuth();
  if (!auth.isAuthenticated || !auth.userId || !auth.botUserId) {
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
  console.log("Telegram inbound message received", {
    chatId,
    topicId,
    messageId: message.id,
    senderId,
  });
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

async function ensureTelegramInboundHandler(): Promise<void> {
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

app.get("/api/bootstrap", (_request, response) => {
  response.json(getAppState());
});

app.get("/api/fs/list", (request, response, next) => {
  try {
    const targetPath = typeof request.query.path === "string" ? request.query.path : undefined;
    response.json({
      path: normalizeExistingDirectoryPath(targetPath),
      entries: listDirectoryNodes(targetPath || "/"),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/send-code", async (request, response, next) => {
  try {
    const apiId = Number(assertNonEmptyString(request.body.apiId, "Telegram API ID"));
    const apiHash = assertNonEmptyString(request.body.apiHash, "Telegram API hash");
    const phoneNumber = assertNonEmptyString(request.body.phoneNumber, "Telegram phone number");
    const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");

    if (!Number.isInteger(apiId) || apiId <= 0) {
      throw new HttpError(400, "Telegram API ID must be a positive integer.");
    }

    const botProfile = await getTelegramBotProfile(botToken);
    const pending = await startPhoneLogin({
      apiId,
      apiHash,
      phoneNumber,
    });

    response.status(201).json({
      pendingAuthId: pending.id,
      phoneNumber,
      isCodeViaApp: pending.isCodeViaApp,
      botUserName: botProfile.username,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-code", async (request, response, next) => {
  try {
    const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
    const phoneCode = assertNonEmptyString(request.body.phoneCode, "Telegram login code");
    const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");
    const pending = getPendingLogin(pendingAuthId);

    if (!pending) {
      throw new HttpError(400, "Pending login session not found.");
    }

    const result = await completePhoneLoginCode({
      pendingId: pendingAuthId,
      phoneCode,
    });

    if (result.status === "password_required") {
      response.json({
        requiresPassword: true,
        pendingAuthId,
        passwordHint: result.passwordHint,
      });
      return;
    }

    const botProfile = await getTelegramBotProfile(botToken);
    saveTelegramAuth({
      apiId: pending.apiId,
      apiHash: pending.apiHash,
      phoneNumber: pending.phoneNumber,
      sessionString: result.sessionString,
      userId: result.user.userId,
      userName: result.user.userName,
      botToken,
      botUserId: botProfile.id,
      botUserName: botProfile.username,
    });
    await ensureTelegramInboundHandler();

    response.json(getAppState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-password", async (request, response, next) => {
  try {
    const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
    const password = assertNonEmptyString(request.body.password, "Telegram 2FA password");
    const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");
    const pending = getPendingLogin(pendingAuthId);

    if (!pending) {
      throw new HttpError(400, "Pending login session not found.");
    }

    const result = await completePhoneLoginPassword({
      pendingId: pendingAuthId,
      password,
    });

    const botProfile = await getTelegramBotProfile(botToken);
    saveTelegramAuth({
      apiId: pending.apiId,
      apiHash: pending.apiHash,
      phoneNumber: pending.phoneNumber,
      sessionString: result.sessionString,
      userId: result.user.userId,
      userName: result.user.userName,
      botToken,
      botUserId: botProfile.id,
      botUserName: botProfile.username,
    });
    await ensureTelegramInboundHandler();

    response.json(getAppState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    const groupName = assertNonEmptyString(request.body.groupName, "Group name");
    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));
    const authConfig = getAuthConfigOrThrow();
    const botConfig = getBotConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);

    const createdGroup = await createForumSupergroup(client, {
      title: groupName,
      about: `Codex project: ${groupName}`,
    });

    await inviteUserToSupergroup(
      client,
      {
        telegramChatId: createdGroup.telegramChannelId,
        telegramAccessHash: createdGroup.telegramAccessHash,
      },
      botConfig.botUserName,
    );

    const project = createProject({
      name: groupName,
      folderPath,
    });

    saveProjectTelegramConnection(project.id, {
      telegramChatId: createdGroup.telegramChannelId,
      telegramAccessHash: createdGroup.telegramAccessHash,
      telegramChatTitle: createdGroup.telegramTitle,
      forumEnabled: createdGroup.forumEnabled,
    });

    broadcastWorkspaceUpdated({
      projectId: project.id,
    });

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

app.put("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    const folderPath = validateFolderPath(assertNonEmptyString(request.body.folderPath, "Project folder path"));

    const updatedProject = updateProject(projectId, {
      name: project.name,
      folderPath,
    });

    broadcastWorkspaceUpdated({
      projectId,
    });

    response.json(updatedProject);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/projects/:projectId", (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    if (!deleteProject(projectId)) {
      throw new HttpError(404, "Project not found.");
    }

    broadcastWorkspaceUpdated({
      projectId,
    });

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/threads", async (request, response, next) => {
  try {
    const projectId = parseNumericId(request.params.projectId);
    const title = assertNonEmptyString(request.body.title, "Thread title");
    const project = getProjectById(projectId);

    if (!project) {
      throw new HttpError(404, "Project not found.");
    }

    if (!project.connection?.telegramChatId || !project.connection.telegramAccessHash) {
      throw new HttpError(400, "Project Telegram connection is missing.");
    }

    const authConfig = getAuthConfigOrThrow();
    const client = await getAuthenticatedClient(authConfig);
    const topic = await createForumTopic(
      client,
      {
        telegramChatId: project.connection.telegramChatId,
        telegramAccessHash: project.connection.telegramAccessHash,
      },
      title,
    );

    const createdThread = createThread({
      projectId,
      title: topic.title,
      telegramTopicId: topic.telegramTopicId,
      telegramTopicName: topic.title,
      origin: "app",
    });

    broadcastWorkspaceUpdated({
      projectId,
      threadId: createdThread.id,
    });

    response.status(201).json(createdThread);
  } catch (error) {
    next(error);
  }
});

app.get("/api/messages/:messageId/attachment", (request, response, next) => {
  try {
    const messageId = parseNumericId(request.params.messageId);
    const attachment = getMessageAttachmentById(messageId);

    if (!attachment) {
      throw new HttpError(404, "Attachment not found.");
    }

    const attachmentPath = path.resolve(attachment.path);
    if (!fs.existsSync(attachmentPath)) {
      throw new HttpError(404, "Attachment file not found.");
    }

    const dispositionType = attachment.kind === "image" ? "inline" : "attachment";
    const filename = attachment.filename || path.basename(attachmentPath);

    response.setHeader(
      "content-disposition",
      `${dispositionType}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.type(attachment.mimeType || "application/octet-stream");
    response.sendFile(attachmentPath);
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

    const auth = getTelegramAuth();
    const senderName = auth.userName || "Telegram User";
    const result = await runConversationTurn({
      project,
      thread,
      content,
      senderName,
      source: "web",
    });

    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/threads/:threadId", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    if (!deleteThread(threadId)) {
      throw new HttpError(404, "Thread not found.");
    }

    broadcastWorkspaceUpdated({
      projectId: thread?.projectId ?? null,
      threadId,
    });

    response.status(204).end();
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

  if (error instanceof TelegramMtprotoError || error instanceof TelegramBotApiError || error instanceof CodexExecutionError) {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Internal server error." });
});

const httpServer = app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server started at ${url}`);
  await ensureTelegramInboundHandler().catch((error) => {
    console.error("Telegram inbound listener failed to start:", error);
  });
  await maybeOpenBrowser(url);
});

const wsServer = new WebSocketServer({
  server: httpServer,
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

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  }).catch(() => undefined);
  wsServer.close();

  await shutdownMtprotoClients().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
