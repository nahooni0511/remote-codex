import { Router } from "express";

import { getTelegramBotProfile } from "../bot";
import { saveTelegramAuth } from "../db";
import { HttpError, assertNonEmptyString } from "../lib/http";
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
} from "../services/runtime";

export const authRouter = Router();

authRouter.post("/api/auth/send-code", async (request, response, next) => {
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

authRouter.post("/api/auth/verify-code", async (request, response, next) => {
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
    await ensureBotCallbackPolling();
    await syncScopedBotCommandsForAllProjects();

    response.json(await getAppState());
  } catch (error) {
    next(error);
  }
});

authRouter.post("/api/auth/verify-password", async (request, response, next) => {
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
    await ensureBotCallbackPolling();
    await syncScopedBotCommandsForAllProjects();

    response.json(await getAppState());
  } catch (error) {
    next(error);
  }
});
