import { getTelegramBotProfile } from "../bot";
import { saveTelegramAuth } from "../db";
import { HttpError } from "../lib/http";
import {
  completePhoneLoginCode,
  completePhoneLoginPassword,
  getPendingLogin,
  startPhoneLogin,
} from "../mtproto";
import {
  ensureBotCallbackPolling,
  ensureTelegramInboundHandler,
  getAppState,
  syncScopedBotCommandsForAllProjects,
} from "./runtime";

export async function startTelegramAuthLogin(input: {
  apiId: number;
  apiHash: string;
  botToken: string;
  phoneNumber: string;
}) {
  if (!Number.isInteger(input.apiId) || input.apiId <= 0) {
    throw new HttpError(400, "Telegram API ID must be a positive integer.");
  }

  const botProfile = await getTelegramBotProfile(input.botToken);
  const pending = await startPhoneLogin({
    apiId: input.apiId,
    apiHash: input.apiHash,
    phoneNumber: input.phoneNumber,
  });

  return {
    pendingAuthId: pending.id,
    phoneNumber: input.phoneNumber,
    isCodeViaApp: pending.isCodeViaApp,
    botUserName: botProfile.username,
  };
}

async function persistTelegramAuth(input: {
  botToken: string;
  pendingAuthId: string;
  sessionString: string;
  user: {
    userId: string;
    userName: string | null;
  };
}) {
  const pending = getPendingLogin(input.pendingAuthId);
  if (!pending) {
    throw new HttpError(400, "Pending login session not found.");
  }

  const botProfile = await getTelegramBotProfile(input.botToken);
  saveTelegramAuth({
    apiId: pending.apiId,
    apiHash: pending.apiHash,
    phoneNumber: pending.phoneNumber,
    sessionString: input.sessionString,
    userId: input.user.userId,
    userName: input.user.userName || "",
    botToken: input.botToken,
    botUserId: botProfile.id,
    botUserName: botProfile.username,
  });
  await ensureTelegramInboundHandler();
  await ensureBotCallbackPolling();
  await syncScopedBotCommandsForAllProjects();
}

export async function verifyTelegramAuthCode(input: {
  botToken: string;
  pendingAuthId: string;
  phoneCode: string;
}) {
  const pending = getPendingLogin(input.pendingAuthId);
  if (!pending) {
    throw new HttpError(400, "Pending login session not found.");
  }

  const result = await completePhoneLoginCode({
    pendingId: input.pendingAuthId,
    phoneCode: input.phoneCode,
  });

  if (result.status === "password_required") {
    return {
      requiresPassword: true as const,
      pendingAuthId: input.pendingAuthId,
      passwordHint: result.passwordHint,
    };
  }

  await persistTelegramAuth({
    botToken: input.botToken,
    pendingAuthId: input.pendingAuthId,
    sessionString: result.sessionString,
    user: result.user,
  });

  return getAppState();
}

export async function verifyTelegramAuthPassword(input: {
  botToken: string;
  password: string;
  pendingAuthId: string;
}) {
  const pending = getPendingLogin(input.pendingAuthId);
  if (!pending) {
    throw new HttpError(400, "Pending login session not found.");
  }

  const result = await completePhoneLoginPassword({
    pendingId: input.pendingAuthId,
    password: input.password,
  });

  await persistTelegramAuth({
    botToken: input.botToken,
    pendingAuthId: input.pendingAuthId,
    sessionString: result.sessionString,
    user: result.user,
  });

  return getAppState();
}
