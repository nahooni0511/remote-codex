import { createHash } from "node:crypto";

import type { Request } from "express";
import type { RelayDeviceSummary } from "@remote-codex/contracts";

import type { RelayDeviceRow, RelayUserRow, SessionRecord } from "./types";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
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

export function toRelaySession(
  row: Pick<RelayUserRow, "cognito_sub" | "email"> | null,
  expiresAt: string | null,
): SessionRecord | null {
  if (!row) {
    return null;
  }

  return {
    user: {
      id: row.cognito_sub,
      email: row.email,
    },
    expiresAt,
  };
}

export function toSummary(row: RelayDeviceRow, connected: boolean): RelayDeviceSummary {
  const lastSeenAt = row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null;
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
