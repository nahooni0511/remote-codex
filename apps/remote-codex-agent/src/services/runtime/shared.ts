import type { CodexPermissionMode } from "@remote-codex/contracts";

import {
  buildLanguageInstruction,
  CodexExecutionError,
  listCodexModels,
  type CodexModelRecord,
} from "../../codex";
import { getCodexSettings, getTelegramAuth, type ThreadRecord } from "../../db";
import { HttpError } from "../../lib/http";
import { TelegramMtprotoError, type TelegramAuthConfig } from "../../mtproto";

let codexModelsCache:
  | {
      loadedAt: number;
      models: CodexModelRecord[];
    }
  | null = null;

export function hasTelegramRuntime(): boolean {
  return getTelegramAuth().isAuthenticated;
}

export function getAuthConfigOrThrow(): TelegramAuthConfig {
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

export function getBotConfigOrThrow(): { botToken: string; botUserId: string; botUserName: string } {
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

export function toBotApiChatId(telegramChannelId: string): string {
  return `-100${telegramChannelId}`;
}

export function combineDeveloperInstructions(...chunks: Array<string | null | undefined>): string | null {
  const parts = chunks.map((chunk) => chunk?.trim() || "").filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof HttpError || error instanceof TelegramMtprotoError || error instanceof CodexExecutionError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}

export function trimTelegramText(text: string): string {
  const normalized = text.trim();
  if (normalized.length <= 3900) {
    return normalized;
  }

  return `${normalized.slice(0, 3880)}\n\n[truncated]`;
}

export async function loadVisibleCodexModels(force = false): Promise<CodexModelRecord[]> {
  const now = Date.now();
  if (!force && codexModelsCache && now - codexModelsCache.loadedAt < 60_000) {
    return codexModelsCache.models;
  }

  const models = (await listCodexModels()).filter((model) => !model.hidden);
  codexModelsCache = {
    loadedAt: now,
    models,
  };
  return models;
}

export async function resolveEffectiveThreadCodexConfig(
  thread: ThreadRecord,
): Promise<{
  model: CodexModelRecord;
  reasoningEffort: string;
  developerInstructions: string | null;
  permissionMode: CodexPermissionMode;
}> {
  const settings = getCodexSettings();
  const models = await loadVisibleCodexModels();
  const selectedModelId = thread.codexModelOverride || settings.defaultModel;
  const fallbackModel = models.find((model) => model.isDefault) || models[0];
  const model =
    models.find((entry) => entry.id === selectedModelId || entry.model === selectedModelId) || fallbackModel;

  if (!model) {
    throw new CodexExecutionError("사용 가능한 Codex model을 찾지 못했습니다.");
  }

  const requestedEffort =
    thread.codexReasoningEffortOverride || settings.defaultReasoningEffort || model.defaultReasoningEffort;
  const reasoningEffort =
    model.supportedReasoningEfforts.includes(requestedEffort)
      ? requestedEffort
      : model.defaultReasoningEffort;

  return {
    model,
    reasoningEffort,
    developerInstructions: buildLanguageInstruction(settings.responseLanguage) || null,
    permissionMode: thread.codexPermissionMode,
  };
}
