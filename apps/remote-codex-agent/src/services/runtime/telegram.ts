import { exec } from "node:child_process";
import { promisify } from "node:util";

import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import type { ComposerAttachmentRecord } from "@remote-codex/contracts";

import {
  answerBotCallbackQuery,
  editTopicMessageTextAsBot,
  getBotUpdates,
  isTelegramBotChatAccessError,
  setScopedBotCommands,
  sendTopicMessageAsBot,
  sendTopicTypingAsBot,
  type TelegramBotCommand,
  type TelegramBotCallbackUpdate,
  type TelegramInlineKeyboardMarkup,
  TelegramBotApiError,
} from "../../bot";
import { listCodexModels, type CodexArtifact, type CodexModelRecord } from "../../codex";
import {
  createMessage,
  createThread,
  getProjectByTelegramChatId,
  getSetting,
  getTelegramAuth,
  getThreadByProjectAndTelegramTopic,
  listProjectsTree,
  setSetting,
  updateThreadCodexOverrides,
  updateThreadTopicMetadata,
  type ProjectRecord,
  type ThreadRecord,
} from "../../db";
import {
  TelegramMtprotoError,
  createForumTopic,
  getAuthenticatedClient,
  getForumTopicById,
  markTopicRead,
  shutdownMtprotoClients,
} from "../../mtproto";
import { HttpError } from "../../lib/http";
import {
  broadcastThreadState,
  broadcastWorkspaceUpdated,
} from "./realtime";
import {
  getAuthConfigOrThrow,
  getBotConfigOrThrow,
  hasTelegramRuntime,
  normalizeErrorMessage,
  resolveEffectiveThreadCodexConfig,
  toBotApiChatId,
} from "./shared";
import { runConversationTurn } from "../runtime";

const execAsync = promisify(exec);
const telegramIncomingMessageEvent = new NewMessage({});
const ignoredTelegramEchoes = new Map<string, number>();

let telegramInboundClient: TelegramClient | null = null;
let telegramInboundHandler:
  | ((event: NewMessageEvent) => Promise<void>)
  | null = null;
let botCallbackPollingPromise: Promise<void> | null = null;
let botCallbackPollingStopped = false;
let botCallbackConflictLogged = false;
let botCallbackPollingGeneration = 0;

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

export async function stopTelegramRuntimeServices(): Promise<void> {
  botCallbackPollingStopped = true;
  botCallbackPollingGeneration += 1;
  await clearTelegramRuntimeState();
}

export async function resetTelegramRuntimeServices(): Promise<void> {
  botCallbackPollingGeneration += 1;
  await clearTelegramRuntimeState();
}

export function rememberIgnoredTelegramEcho(chatId: string, messageId: number): void {
  const key = `${chatId}:${messageId}`;
  ignoredTelegramEchoes.set(key, Date.now() + 30_000);
}

function isIgnoredTelegramEcho(chatId: string, messageId: number): boolean {
  const key = `${chatId}:${messageId}`;
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

export function startBotTypingLoop(input: {
  botToken: string;
  chatId: string;
  topicId: number;
}): () => void {
  const tick = () => sendTopicTypingAsBot(input).catch(() => undefined);

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 4000);

  return () => {
    clearInterval(timer);
  };
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

async function loadVisibleCodexModels(): Promise<CodexModelRecord[]> {
  return (await listCodexModels()).filter((model) => !model.hidden);
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
    return { type: "model", argument: argument.trim(), raw: trimmed };
  }
  if (commandName === "model_reasoning_effort") {
    return { type: "model_reasoning_effort", argument: argument.trim().toLowerCase(), raw: trimmed };
  }
  if (commandName === "plan") {
    return { type: "plan", argument: argument.trim(), raw: trimmed };
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

function buildReasoningEffortKeyboard(model: CodexModelRecord): TelegramInlineKeyboardMarkup {
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
  try {
    await setScopedBotCommands({
      botToken: botConfig.botToken,
      chatId: toBotApiChatId(connection.telegramChatId),
      commands: BOT_COMMANDS,
    });
  } catch (error) {
    if (isTelegramBotChatAccessError(error)) {
      console.warn(
        `Skipping bot command sync for project "${project.name}" (${connection.telegramChatId}): ${error.message}`,
      );
      return;
    }

    throw error;
  }
}

export async function syncScopedBotCommandsForAllProjects(): Promise<void> {
  if (!hasTelegramRuntime()) {
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
  if (!hasTelegramRuntime() || botCallbackPollingPromise || botCallbackPollingStopped) {
    return;
  }

  const pollingGeneration = botCallbackPollingGeneration;
  botCallbackPollingPromise = (async () => {
    while (!botCallbackPollingStopped && pollingGeneration === botCallbackPollingGeneration) {
      if (!hasTelegramRuntime()) {
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

        if (!hasTelegramRuntime() || pollingGeneration !== botCallbackPollingGeneration) {
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
      hasTelegramRuntime()
    ) {
      void ensureBotCallbackPolling().catch((error) => {
        console.error("Telegram bot callback polling failed to restart:", error);
      });
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

  const content = message.message.trim();
  if (!content) {
    return;
  }

  const sender = await message.getSender().catch(() => undefined);
  const parsedCommand = parseTelegramCommand(content, auth.botUserName);
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
  if (!hasTelegramRuntime()) {
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
}
