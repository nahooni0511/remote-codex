import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { Request } from "express";
import type { RelayDeviceSummary } from "@remote-codex/contracts";

import type { RelayDeviceRow, RelayUserRow, SessionRecord } from "./types";

const scrypt = promisify(nodeScrypt);

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function hashToken(token: string): string {
  return hashSecret(token);
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPasswordHash(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  const [algorithm, salt, expectedHex] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) {
    return false;
  }

  const actual = (await scrypt(password, salt, expectedHex.length / 2)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export function parseBearerToken(request: Request): string | null {
  const header = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

export function getRequestBaseUrl(request: Request, port: number): string {
  const proto = String(request.headers["x-forwarded-proto"] || request.protocol || "http");
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${port}`);
  return `${proto}://${host}`;
}

export function buildWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, "ws")}/ws/bridge`;
}

export function toSqlDateTime(value: Date | string = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function fromSqlDateTime(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        value.getMilliseconds(),
      ),
    );
  }

  if (value.includes("T")) {
    return new Date(value);
  }

  return new Date(value.replace(" ", "T") + "Z");
}

export function toRelaySession(
  row: Pick<RelayUserRow, "id" | "email"> | null,
  expiresAt: string | null,
): SessionRecord | null {
  if (!row) {
    return null;
  }

  return {
    user: {
      id: row.id,
      email: row.email,
    },
    expiresAt,
  };
}

export function toSummary(row: RelayDeviceRow, connected: boolean): RelayDeviceSummary {
  const lastSeenAt = row.last_seen_at ? fromSqlDateTime(row.last_seen_at).toISOString() : null;
  return {
    deviceId: row.device_id,
    displayName: row.display_name,
    ownerEmail: row.owner_email,
    appVersion: row.app_version,
    protocolVersion: row.protocol_version,
    minSupportedProtocol: row.min_supported_protocol,
    devicePublicKey: row.device_public_key,
    connected,
    lastSeenAt,
    snapshotUpdatedAt: lastSeenAt,
    blockedReason: null,
  };
}
