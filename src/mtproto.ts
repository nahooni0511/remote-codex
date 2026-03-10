import { randomUUID } from "node:crypto";

import { Api, TelegramClient } from "telegram";
import { generateRandomLong, returnBigInt } from "telegram/Helpers";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";

export interface TelegramAuthConfig {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
}

export interface TelegramAuthenticatedUser {
  userId: string;
  userName: string;
  phoneNumber: string;
}

export interface PendingLoginSession {
  id: string;
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  phoneCodeHash: string;
  isCodeViaApp: boolean;
  createdAt: string;
  passwordHint: string | null;
  client: TelegramClient;
}

export interface CreatedForumSupergroup {
  telegramChannelId: string;
  telegramAccessHash: string;
  telegramTitle: string;
  forumEnabled: boolean;
}

export interface CreatedForumTopic {
  telegramTopicId: number;
  title: string;
}

const pendingLogins = new Map<string, PendingLoginSession>();
let cachedClient: TelegramClient | null = null;
let cachedClientKey: string | null = null;

export class TelegramMtprotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramMtprotoError";
  }
}

function formatUserDisplayName(user: Api.TypeUser): string {
  if (!(user instanceof Api.User)) {
    return "Telegram User";
  }

  const parts = [user.firstName, user.lastName].filter(Boolean);
  if (parts.length) {
    return parts.join(" ");
  }

  if (user.username) {
    return `@${user.username}`;
  }

  return user.phone || "Telegram User";
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "errorMessage" in error) {
    const message = String((error as { errorMessage: unknown }).errorMessage || "");
    if (message === "SESSION_PASSWORD_NEEDED") {
      return "Telegram 2단계 인증 비밀번호가 필요합니다.";
    }

    return message || "Telegram 요청에 실패했습니다.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Telegram 요청에 실패했습니다.";
}

async function buildClient(config: {
  apiId: number;
  apiHash: string;
  sessionString?: string;
}): Promise<TelegramClient> {
  const client = new TelegramClient(
    new StringSession(config.sessionString || ""),
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 5,
      autoReconnect: true,
    },
  );

  await client.connect();
  return client;
}

function buildClientCacheKey(config: TelegramAuthConfig): string {
  return `${config.apiId}:${config.apiHash}:${config.sessionString}`;
}

export async function getAuthenticatedClient(config: TelegramAuthConfig): Promise<TelegramClient> {
  const cacheKey = buildClientCacheKey(config);

  if (cachedClient && cachedClientKey === cacheKey) {
    await cachedClient.connect();
    return cachedClient;
  }

  if (cachedClient) {
    await cachedClient.disconnect().catch(() => undefined);
    cachedClient = null;
    cachedClientKey = null;
  }

  const client = await buildClient(config);
  const authorized = await client.checkAuthorization();
  if (!authorized) {
    await client.disconnect().catch(() => undefined);
    throw new TelegramMtprotoError("Telegram 사용자 로그인 세션이 만료되었습니다.");
  }

  cachedClient = client;
  cachedClientKey = cacheKey;
  return client;
}

export async function startPhoneLogin(input: {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
}): Promise<PendingLoginSession> {
  const client = await buildClient({
    apiId: input.apiId,
    apiHash: input.apiHash,
  });

  try {
    const { phoneCodeHash, isCodeViaApp } = await client.sendCode(
      {
        apiId: input.apiId,
        apiHash: input.apiHash,
      },
      input.phoneNumber,
    );

    const pending: PendingLoginSession = {
      id: randomUUID(),
      apiId: input.apiId,
      apiHash: input.apiHash,
      phoneNumber: input.phoneNumber,
      phoneCodeHash,
      isCodeViaApp,
      createdAt: new Date().toISOString(),
      passwordHint: null,
      client,
    };

    pendingLogins.set(pending.id, pending);
    return pending;
  } catch (error) {
    await client.disconnect().catch(() => undefined);
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

export function getPendingLogin(pendingId: string): PendingLoginSession | null {
  return pendingLogins.get(pendingId) || null;
}

export async function clearPendingLogin(pendingId: string): Promise<void> {
  const pending = pendingLogins.get(pendingId);
  if (!pending) {
    return;
  }

  pendingLogins.delete(pendingId);
  await pending.client.disconnect().catch(() => undefined);
}

export async function shutdownMtprotoClients(): Promise<void> {
  const disconnects = Array.from(pendingLogins.values()).map((pending) =>
    pending.client.disconnect().catch(() => undefined),
  );

  pendingLogins.clear();
  await Promise.all(disconnects);

  if (cachedClient) {
    await cachedClient.disconnect().catch(() => undefined);
    cachedClient = null;
    cachedClientKey = null;
  }
}

async function finalizeAuthorizedClient(
  pending: PendingLoginSession,
  user: Api.TypeUser,
): Promise<{
  sessionString: string;
  user: TelegramAuthenticatedUser;
}> {
  const sessionString = (pending.client.session as StringSession).save();
  if (!sessionString) {
    throw new TelegramMtprotoError("Telegram 로그인 세션 저장에 실패했습니다.");
  }
  const authUser: TelegramAuthenticatedUser = {
    userId:
      user instanceof Api.User && user.id !== undefined ? user.id.toString() : "unknown",
    userName: formatUserDisplayName(user),
    phoneNumber: pending.phoneNumber,
  };

  pendingLogins.delete(pending.id);
  return {
    sessionString,
    user: authUser,
  };
}

export async function completePhoneLoginCode(input: {
  pendingId: string;
  phoneCode: string;
}): Promise<
  | {
      status: "authenticated";
      sessionString: string;
      user: TelegramAuthenticatedUser;
    }
  | {
      status: "password_required";
      passwordHint: string | null;
    }
> {
  const pending = getPendingLogin(input.pendingId);
  if (!pending) {
    throw new TelegramMtprotoError("로그인 세션을 찾을 수 없습니다. 다시 코드를 요청하세요.");
  }

  try {
    const authorization = await pending.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: pending.phoneNumber,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: input.phoneCode,
      }),
    );

    if (authorization instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new TelegramMtprotoError("아직 Telegram에 가입되지 않은 전화번호입니다.");
    }

    return {
      status: "authenticated",
      ...(await finalizeAuthorizedClient(pending, authorization.user)),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "errorMessage" in error &&
      String((error as { errorMessage: unknown }).errorMessage) === "SESSION_PASSWORD_NEEDED"
    ) {
      const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
      pending.passwordHint = passwordInfo.hint || null;
      return {
        status: "password_required",
        passwordHint: pending.passwordHint,
      };
    }

    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

export async function completePhoneLoginPassword(input: {
  pendingId: string;
  password: string;
}): Promise<{
  sessionString: string;
  user: TelegramAuthenticatedUser;
}> {
  const pending = getPendingLogin(input.pendingId);
  if (!pending) {
    throw new TelegramMtprotoError("로그인 세션을 찾을 수 없습니다. 다시 코드를 요청하세요.");
  }

  try {
    const passwordInfo = await pending.client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordInfo, input.password);
    const authorization = await pending.client.invoke(
      new Api.auth.CheckPassword({
        password: passwordCheck,
      }),
    );

    if (authorization instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new TelegramMtprotoError("아직 Telegram에 가입되지 않은 계정입니다.");
    }

    return finalizeAuthorizedClient(pending, authorization.user);
  } catch (error) {
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

function ensureChannelFromUpdates(updates: Api.TypeUpdates): Api.Channel {
  const chats = "chats" in updates ? updates.chats : [];
  const channel = chats.find((chat) => chat instanceof Api.Channel);

  if (!(channel instanceof Api.Channel) || channel.id === undefined || channel.accessHash === undefined) {
    throw new TelegramMtprotoError("생성된 Telegram supergroup 정보를 확인하지 못했습니다.");
  }

  return channel;
}

function ensureTopicFromUpdates(updates: Api.TypeUpdates): CreatedForumTopic {
  const updateList = "updates" in updates ? updates.updates : [];

  for (const update of updateList) {
    if (
      (update instanceof Api.UpdateNewChannelMessage || update instanceof Api.UpdateNewMessage) &&
      update.message instanceof Api.Message &&
      update.message.action instanceof Api.MessageActionTopicCreate
    ) {
      return {
        telegramTopicId: update.message.id,
        title: update.message.action.title,
      };
    }
  }

  throw new TelegramMtprotoError("생성된 forum topic 정보를 확인하지 못했습니다.");
}

async function findCreatedTopicViaLookup(
  client: TelegramClient,
  connection: {
    telegramChatId: string;
    telegramAccessHash: string;
  },
  title: string,
): Promise<CreatedForumTopic | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await client.invoke(
      new Api.channels.GetForumTopics({
        channel: toInputChannel(connection),
        q: title,
        offsetDate: 0,
        offsetId: 0,
        offsetTopic: 0,
        limit: 20,
      }),
    );

    if (result instanceof Api.messages.ForumTopics) {
      const matchedTopics = result.topics
        .filter((topic): topic is Api.ForumTopic => topic instanceof Api.ForumTopic)
        .filter((topic) => topic.title === title && topic.topMessage > 0)
        .sort((left, right) => right.date - left.date);

      if (matchedTopics.length) {
        return {
          telegramTopicId: matchedTopics[0].topMessage,
          title: matchedTopics[0].title,
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return null;
}

function toInputChannel(connection: {
  telegramChatId: string;
  telegramAccessHash: string;
}): Api.InputChannel {
  return new Api.InputChannel({
    channelId: returnBigInt(connection.telegramChatId),
    accessHash: returnBigInt(connection.telegramAccessHash),
  });
}

function toInputPeerChannel(connection: {
  telegramChatId: string;
  telegramAccessHash: string;
}): Api.InputPeerChannel {
  return new Api.InputPeerChannel({
    channelId: returnBigInt(connection.telegramChatId),
    accessHash: returnBigInt(connection.telegramAccessHash),
  });
}

export async function createForumSupergroup(
  client: TelegramClient,
  input: {
    title: string;
    about?: string;
  },
): Promise<CreatedForumSupergroup> {
  try {
    const updates = await client.invoke(
      new Api.channels.CreateChannel({
        title: input.title,
        about: input.about || "",
        megagroup: true,
        forum: true,
      }),
    );

    const channel = ensureChannelFromUpdates(updates);
    let forumEnabled = Boolean(channel.forum);

    if (!forumEnabled) {
      await client.invoke(
        new Api.channels.ToggleForum({
          channel: toInputChannel({
            telegramChatId: channel.id.toString(),
            telegramAccessHash: channel.accessHash!.toString(),
          }),
          enabled: true,
        }),
      );
      forumEnabled = true;
    }

    return {
      telegramChannelId: channel.id.toString(),
      telegramAccessHash: channel.accessHash!.toString(),
      telegramTitle: channel.title,
      forumEnabled,
    };
  } catch (error) {
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

export async function createForumTopic(
  client: TelegramClient,
  connection: {
    telegramChatId: string;
    telegramAccessHash: string;
  },
  title: string,
): Promise<CreatedForumTopic> {
  try {
    const updates = await client.invoke(
      new Api.channels.CreateForumTopic({
        channel: toInputChannel(connection),
        title,
        randomId: generateRandomLong(),
      }),
    );

    const directTopic = (() => {
      try {
        return ensureTopicFromUpdates(updates);
      } catch {
        return null;
      }
    })();

    if (directTopic) {
      return directTopic;
    }

    const lookedUpTopic = await findCreatedTopicViaLookup(client, connection, title);
    if (lookedUpTopic) {
      return lookedUpTopic;
    }

    throw new TelegramMtprotoError("생성된 forum topic 정보를 확인하지 못했습니다.");
  } catch (error) {
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

export async function sendTopicMessage(
  client: TelegramClient,
  connection: {
    telegramChatId: string;
    telegramAccessHash: string;
  },
  topicId: number,
  message: string,
): Promise<{ telegramMessageId: number }> {
  try {
    const sent = await client.sendMessage(toInputPeerChannel(connection), {
      message,
      replyTo: topicId,
      topMsgId: topicId,
    });

    return {
      telegramMessageId: sent.id,
    };
  } catch (error) {
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}

export async function inviteUserToSupergroup(
  client: TelegramClient,
  connection: {
    telegramChatId: string;
    telegramAccessHash: string;
  },
  username: string,
): Promise<void> {
  try {
    const userEntity = await client.getInputEntity(username.startsWith("@") ? username : `@${username}`);
    await client.invoke(
      new Api.channels.InviteToChannel({
        channel: toInputChannel(connection),
        users: [userEntity],
      }),
    );
  } catch (error) {
    throw new TelegramMtprotoError(normalizeErrorMessage(error));
  }
}
