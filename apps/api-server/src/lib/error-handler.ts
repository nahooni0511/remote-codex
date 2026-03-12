import type { NextFunction, Request, Response } from "express";

import { TelegramBotApiError } from "../bot";
import { CodexExecutionError } from "../codex";
import { HttpError } from "./http";
import { TelegramMtprotoError } from "../mtproto";

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    response.status(error.statusCode).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    return;
  }

  if (error instanceof TelegramMtprotoError || error instanceof TelegramBotApiError || error instanceof CodexExecutionError) {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Internal server error." });
}
