import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { repoRoot } from "../lib/paths";
import type {
  CodexSettingsRecord,
  DeviceProfileRecord,
  DeviceProfileRow,
  GlobalPairingRecord,
  GlobalPairingRow,
  TelegramAuthRecord,
} from "./types";
import { db, nowIso } from "./core";
import { mapDeviceProfile, mapGlobalPairing } from "./mappers";

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM global_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `
      INSERT INTO global_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
  ).run(key, value, nowIso());
}

export function clearSetting(key: string): void {
  db.prepare("DELETE FROM global_settings WHERE key = ?").run(key);
}

function setOptionalSetting(key: string, value: string | null | undefined): void {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    clearSetting(key);
    return;
  }

  setSetting(key, normalized);
}

export function getTelegramAuth(): TelegramAuthRecord {
  const apiId = Number(getSetting("telegram_api_id") || 0) || null;
  const apiHash = getSetting("telegram_api_hash");
  const phoneNumber = getSetting("telegram_phone_number");
  const sessionString = getSetting("telegram_session_string");
  const userId = getSetting("telegram_user_id");
  const userName = getSetting("telegram_user_name");
  const botToken = getSetting("telegram_bot_token");
  const botUserId = getSetting("telegram_bot_user_id");
  const botUserName = getSetting("telegram_bot_username");

  return {
    apiId,
    apiHash,
    phoneNumber,
    sessionString,
    userId,
    userName,
    botToken,
    botUserId,
    botUserName,
    isAuthenticated: Boolean(apiId && apiHash && phoneNumber && sessionString && botToken),
  };
}

export function saveTelegramAuth(input: {
  apiId: number;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
  userId: string;
  userName: string;
  botToken: string;
  botUserId: string;
  botUserName: string;
}): void {
  setSetting("telegram_api_id", String(input.apiId));
  setSetting("telegram_api_hash", input.apiHash);
  setSetting("telegram_phone_number", input.phoneNumber);
  setSetting("telegram_session_string", input.sessionString);
  setSetting("telegram_user_id", input.userId);
  setSetting("telegram_user_name", input.userName);
  setSetting("telegram_bot_token", input.botToken);
  setSetting("telegram_bot_user_id", input.botUserId);
  setSetting("telegram_bot_username", input.botUserName);
}

export function clearTelegramAuth(): void {
  const keys = [
    "telegram_api_id",
    "telegram_api_hash",
    "telegram_phone_number",
    "telegram_session_string",
    "telegram_user_id",
    "telegram_user_name",
    "telegram_bot_token",
    "telegram_bot_user_id",
    "telegram_bot_username",
  ];

  for (const key of keys) {
    clearSetting(key);
  }
}

export function getCodexSettings(): CodexSettingsRecord {
  return {
    responseLanguage: getSetting("codex_response_language") || "",
    defaultModel: getSetting("codex_default_model") || "",
    defaultReasoningEffort: getSetting("codex_default_reasoning_effort") || "",
  };
}

export function saveCodexSettings(input: {
  responseLanguage?: string | null;
  defaultModel?: string | null;
  defaultReasoningEffort?: string | null;
}): CodexSettingsRecord {
  setOptionalSetting("codex_response_language", input.responseLanguage);
  setOptionalSetting("codex_default_model", input.defaultModel);
  setOptionalSetting("codex_default_reasoning_effort", input.defaultReasoningEffort);
  return getCodexSettings();
}

export function resetCodexSettings(): CodexSettingsRecord {
  clearSetting("codex_response_language");
  clearSetting("codex_default_model");
  clearSetting("codex_default_reasoning_effort");
  return getCodexSettings();
}

export function isSetupComplete(): boolean {
  return true;
}

function getAppVersion(): string {
  try {
    const packageJsonPath = path.resolve(repoRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getPublicSettings(): {
  codexBin: string;
  codexResponseLanguage: string;
  codexDefaultModel: string;
  codexDefaultReasoningEffort: string;
  telegramApiId: string;
  telegramApiHash: string;
  telegramPhoneNumber: string;
  telegramBotToken: string;
  telegramUserName: string;
  telegramBotUserName: string;
} {
  const auth = getTelegramAuth();
  const codex = getCodexSettings();

  return {
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
    codexResponseLanguage: codex.responseLanguage,
    codexDefaultModel: codex.defaultModel || process.env.CODEX_MODEL?.trim() || "",
    codexDefaultReasoningEffort:
      codex.defaultReasoningEffort || process.env.CODEX_REASONING_EFFORT?.trim() || "",
    telegramApiId: auth.apiId ? String(auth.apiId) : "",
    telegramApiHash: auth.apiHash ? "configured" : "",
    telegramPhoneNumber: auth.phoneNumber || "",
    telegramBotToken: auth.botToken ? "configured" : "",
    telegramUserName: auth.userName || "",
    telegramBotUserName: auth.botUserName || "",
  };
}

export function getDeviceProfile(): DeviceProfileRecord {
  const existing = db.prepare("SELECT * FROM device_profile WHERE id = 1").get() as
    | DeviceProfileRow
    | undefined;
  if (existing) {
    return mapDeviceProfile(existing);
  }

  const timestamp = nowIso();
  const profile = {
    localDeviceId: randomUUID(),
    displayName: `${os.hostname()} Local Codex`,
    hostName: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    appVersion: getAppVersion(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.prepare(
    `
      INSERT INTO device_profile (
        id,
        local_device_id,
        display_name,
        host_name,
        os,
        platform,
        app_version,
        created_at,
        updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    profile.localDeviceId,
    profile.displayName,
    profile.hostName,
    profile.os,
    profile.platform,
    profile.appVersion,
    profile.createdAt,
    profile.updatedAt,
  );

  return profile;
}

export function getGlobalPairing(): GlobalPairingRecord | null {
  const row = db.prepare("SELECT * FROM global_pairing WHERE id = 1").get() as GlobalPairingRow | undefined;
  return row ? mapGlobalPairing(row) : null;
}

export function saveGlobalPairing(input: {
  enabled?: boolean;
  deviceId?: string | null;
  deviceSecret?: string | null;
  ownerLabel?: string | null;
  serverUrl?: string | null;
  wsUrl?: string | null;
  connected?: boolean;
  lastSyncAt?: string | null;
}): GlobalPairingRecord {
  const existing = getGlobalPairing();
  const timestamp = nowIso();
  const next = {
    enabled: input.enabled ?? existing?.enabled ?? true,
    deviceId: input.deviceId ?? existing?.deviceId ?? null,
    deviceSecret: input.deviceSecret ?? existing?.deviceSecret ?? null,
    ownerLabel: input.ownerLabel ?? existing?.ownerLabel ?? null,
    serverUrl: input.serverUrl ?? existing?.serverUrl ?? null,
    wsUrl: input.wsUrl ?? existing?.wsUrl ?? null,
    connected: input.connected ?? existing?.connected ?? false,
    lastSyncAt: input.lastSyncAt ?? existing?.lastSyncAt ?? null,
  };

  db.prepare(
    `
      INSERT INTO global_pairing (
        id,
        enabled,
        device_id,
        device_secret,
        owner_label,
        server_url,
        ws_url,
        connected,
        last_sync_at,
        created_at,
        updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id)
      DO UPDATE SET
        enabled = excluded.enabled,
        device_id = excluded.device_id,
        device_secret = excluded.device_secret,
        owner_label = excluded.owner_label,
        server_url = excluded.server_url,
        ws_url = excluded.ws_url,
        connected = excluded.connected,
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    next.enabled ? 1 : 0,
    next.deviceId,
    next.deviceSecret,
    next.ownerLabel,
    next.serverUrl,
    next.wsUrl,
    next.connected ? 1 : 0,
    next.lastSyncAt,
    existing?.createdAt ?? timestamp,
    timestamp,
  );

  return getGlobalPairing()!;
}

export function clearGlobalPairing(): void {
  db.prepare("DELETE FROM global_pairing WHERE id = 1").run();
}
