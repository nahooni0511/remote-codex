const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramVerificationResult {
  botId: number;
  botUsername: string | null;
  telegramChatId: string;
  telegramChatTitle: string;
  forumEnabled: boolean;
  botJoined: boolean;
  botIsAdmin: boolean;
  canManageTopics: boolean;
  rawMembershipStatus: string;
}

export interface CreatedTopicResult {
  telegramTopicId: number;
  title: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramIncomingMessage;
}

export interface TelegramIncomingMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  date: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  from?: TelegramUser;
  forum_topic_created?: TelegramForumTopicCreated;
  reply_to_message?: {
    forum_topic_created?: TelegramForumTopicCreated;
  };
}

export interface TelegramForumTopicCreated {
  name: string;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number | string;
  title?: string;
  type: string;
  is_forum?: boolean;
}

interface TelegramChatMember {
  status: string;
  can_manage_topics?: boolean;
}

interface TelegramForumTopic {
  message_thread_id: number;
  name: string;
}

interface TelegramSentMessage {
  message_id: number;
}

export class TelegramApiError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "TelegramApiError";
    this.statusCode = statusCode;
  }
}

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let body: TelegramResponse<T>;

  try {
    body = (await response.json()) as TelegramResponse<T>;
  } catch {
    throw new TelegramApiError("Telegram API returned a non-JSON response.", response.status);
  }

  if (!response.ok || !body.ok || body.result === undefined) {
    throw new TelegramApiError(body.description ?? "Telegram API request failed.", body.error_code ?? response.status);
  }

  return body.result;
}

export async function verifyTelegramConnection(
  botToken: string,
  telegramChatId: string,
): Promise<TelegramVerificationResult> {
  const normalizedChatId = telegramChatId.trim();

  if (!normalizedChatId) {
    throw new TelegramApiError("Telegram supergroup ID is required.");
  }

  const bot = await callTelegramApi<TelegramUser>(botToken, "getMe", {});
  const chat = await callTelegramApi<TelegramChat>(botToken, "getChat", { chat_id: normalizedChatId });
  const membership = await callTelegramApi<TelegramChatMember>(botToken, "getChatMember", {
    chat_id: normalizedChatId,
    user_id: bot.id,
  });

  const botJoined = membership.status !== "left" && membership.status !== "kicked";
  const botIsAdmin = membership.status === "administrator" || membership.status === "creator";
  const canManageTopics = membership.status === "creator" || Boolean(membership.can_manage_topics);

  return {
    botId: bot.id,
    botUsername: bot.username ?? null,
    telegramChatId: String(chat.id),
    telegramChatTitle: chat.title ?? "",
    forumEnabled: Boolean(chat.is_forum),
    botJoined,
    botIsAdmin,
    canManageTopics,
    rawMembershipStatus: membership.status,
  };
}

export async function createTelegramForumTopic(
  botToken: string,
  telegramChatId: string,
  title: string,
): Promise<CreatedTopicResult> {
  const topic = await callTelegramApi<TelegramForumTopic>(botToken, "createForumTopic", {
    chat_id: telegramChatId,
    name: title,
  });

  return {
    telegramTopicId: topic.message_thread_id,
    title: topic.name,
  };
}

export async function sendTelegramTopicMessage(input: {
  botToken: string;
  telegramChatId: string;
  telegramTopicId: number;
  text: string;
}): Promise<{ telegramMessageId: number }> {
  const message = await callTelegramApi<TelegramSentMessage>(input.botToken, "sendMessage", {
    chat_id: input.telegramChatId,
    message_thread_id: input.telegramTopicId,
    text: input.text,
  });

  return {
    telegramMessageId: message.message_id,
  };
}

export async function getTelegramUpdates(
  botToken: string,
  offset: number,
): Promise<TelegramUpdate[]> {
  return callTelegramApi<TelegramUpdate[]>(botToken, "getUpdates", {
    offset,
    timeout: 0,
    limit: 100,
    allowed_updates: ["message"],
  });
}
