export interface TelegramBotProfile {
  id: string;
  username: string;
  firstName: string;
}

export class TelegramBotApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramBotApiError";
  }
}

interface BotApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface BotApiMessage {
  message_id: number;
}

function buildBotApiUrl(botToken: string, method: string): string {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

async function callBotApi<T>(
  botToken: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(buildBotApiUrl(botToken, method), {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = (await response.json()) as BotApiEnvelope<T>;
  if (!response.ok || !data.ok || data.result === undefined) {
    throw new TelegramBotApiError(data.description || `Telegram Bot API request failed: ${method}`);
  }

  return data.result;
}

export async function getTelegramBotProfile(botToken: string): Promise<TelegramBotProfile> {
  const result = await callBotApi<{
    id: number;
    username?: string;
    first_name?: string;
  }>(botToken, "getMe");

  if (!result.username) {
    throw new TelegramBotApiError("Telegram bot username를 확인할 수 없습니다.");
  }

  return {
    id: String(result.id),
    username: result.username,
    firstName: result.first_name || result.username,
  };
}

export async function sendTopicMessageAsBot(input: {
  botToken: string;
  chatId: string;
  topicId: number;
  text: string;
}): Promise<{ telegramMessageId: number }> {
  const result = await callBotApi<BotApiMessage>(input.botToken, "sendMessage", {
    chat_id: input.chatId,
    message_thread_id: input.topicId,
    text: input.text,
  });

  return {
    telegramMessageId: result.message_id,
  };
}
