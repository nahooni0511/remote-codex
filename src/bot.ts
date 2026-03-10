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

function toBlobPart(buffer: Buffer): ArrayBuffer {
  const bytes = Uint8Array.from(buffer);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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

async function callBotApiMultipart<T>(
  botToken: string,
  method: string,
  formData: FormData,
): Promise<T> {
  const response = await fetch(buildBotApiUrl(botToken, method), {
    method: "POST",
    body: formData,
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
  replyToMessageId?: number;
}): Promise<{ telegramMessageId: number }> {
  const result = await callBotApi<BotApiMessage>(input.botToken, "sendMessage", {
    chat_id: input.chatId,
    message_thread_id: input.topicId,
    text: input.text,
    reply_to_message_id: input.replyToMessageId,
  });

  return {
    telegramMessageId: result.message_id,
  };
}

export async function sendTopicTypingAsBot(input: {
  botToken: string;
  chatId: string;
  topicId: number;
}): Promise<void> {
  await callBotApi<true>(input.botToken, "sendChatAction", {
    chat_id: input.chatId,
    message_thread_id: input.topicId,
    action: "typing",
  });
}

export async function sendTopicPhotoAsBot(input: {
  botToken: string;
  chatId: string;
  topicId: number;
  photo: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
  replyToMessageId?: number;
}): Promise<{ telegramMessageId: number }> {
  const formData = new FormData();
  formData.set("chat_id", input.chatId);
  formData.set("message_thread_id", String(input.topicId));

  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", String(input.replyToMessageId));
  }

  if (input.caption?.trim()) {
    formData.set("caption", input.caption.trim());
  }

  formData.set(
    "photo",
    new Blob([toBlobPart(input.photo)], {
      type: input.mimeType || "image/png",
    }),
    input.filename,
  );

  const result = await callBotApiMultipart<BotApiMessage>(input.botToken, "sendPhoto", formData);
  return {
    telegramMessageId: result.message_id,
  };
}

export async function sendTopicDocumentAsBot(input: {
  botToken: string;
  chatId: string;
  topicId: number;
  document: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
  replyToMessageId?: number;
}): Promise<{ telegramMessageId: number }> {
  const formData = new FormData();
  formData.set("chat_id", input.chatId);
  formData.set("message_thread_id", String(input.topicId));

  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", String(input.replyToMessageId));
  }

  if (input.caption?.trim()) {
    formData.set("caption", input.caption.trim());
  }

  formData.set(
    "document",
    new Blob([toBlobPart(input.document)], {
      type: input.mimeType || "application/octet-stream",
    }),
    input.filename,
  );

  const result = await callBotApiMultipart<BotApiMessage>(input.botToken, "sendDocument", formData);
  return {
    telegramMessageId: result.message_id,
  };
}
