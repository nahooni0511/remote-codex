import type { Request, Response } from "express";

import { assertNonEmptyString } from "../lib/http";
import {
  startTelegramAuthLogin,
  verifyTelegramAuthCode,
  verifyTelegramAuthPassword,
} from "../services/auth-service";

export async function sendTelegramAuthCode(request: Request, response: Response) {
  const apiId = Number(assertNonEmptyString(request.body.apiId, "Telegram API ID"));
  const apiHash = assertNonEmptyString(request.body.apiHash, "Telegram API hash");
  const phoneNumber = assertNonEmptyString(request.body.phoneNumber, "Telegram phone number");
  const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");

  response.status(201).json(
    await startTelegramAuthLogin({
      apiId,
      apiHash,
      botToken,
      phoneNumber,
    }),
  );
}

export async function verifyTelegramCode(request: Request, response: Response) {
  const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
  const phoneCode = assertNonEmptyString(request.body.phoneCode, "Telegram login code");
  const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");

  response.json(
    await verifyTelegramAuthCode({
      botToken,
      pendingAuthId,
      phoneCode,
    }),
  );
}

export async function verifyTelegramPassword(request: Request, response: Response) {
  const pendingAuthId = assertNonEmptyString(request.body.pendingAuthId, "Pending auth ID");
  const password = assertNonEmptyString(request.body.password, "Telegram 2FA password");
  const botToken = assertNonEmptyString(request.body.botToken, "Telegram bot token");

  response.json(
    await verifyTelegramAuthPassword({
      botToken,
      password,
      pendingAuthId,
    }),
  );
}
