import type { Pool } from "mysql2/promise";

import { toSqlDateTime } from "../helpers";
import type { RelayDeviceRow } from "../types";

export async function getDeviceRow(pool: Pool, deviceId: string): Promise<RelayDeviceRow | null> {
  const [rows] = await pool.execute<RelayDeviceRow[]>(
    `
      SELECT
        device_id,
        owner_user_id,
        owner_cognito_sub,
        owner_email,
        display_name,
        device_secret_hash,
        device_public_key,
        app_version,
        protocol_version,
        min_supported_protocol,
        last_seen_at,
        created_at,
        updated_at
      FROM relay_devices
      WHERE device_id = ?
      LIMIT 1
    `,
    [deviceId],
  );
  return rows[0] || null;
}

export async function listDeviceRowsByOwner(pool: Pool, ownerUserId: string): Promise<RelayDeviceRow[]> {
  const [rows] = await pool.execute<RelayDeviceRow[]>(
    `
      SELECT
        device_id,
        owner_user_id,
        owner_cognito_sub,
        owner_email,
        display_name,
        device_secret_hash,
        device_public_key,
        app_version,
        protocol_version,
        min_supported_protocol,
        last_seen_at,
        created_at,
        updated_at
      FROM relay_devices
      WHERE owner_user_id = ?
      ORDER BY display_name ASC
    `,
    [ownerUserId],
  );
  return rows as RelayDeviceRow[];
}

export async function updateRegisteredDevice(
  pool: Pool,
  input: {
    appVersion: string;
    deviceId: string;
    devicePublicKey: string;
    displayName: string;
    lastSeenAt: string;
    minSupportedProtocol: string;
    ownerEmail: string | null;
    protocolVersion: string;
  },
): Promise<void> {
  const dbTimestamp = toSqlDateTime(input.lastSeenAt);
  await pool.execute(
    `
      UPDATE relay_devices
      SET
        owner_email = ?,
        display_name = ?,
        device_public_key = ?,
        app_version = ?,
        protocol_version = ?,
        min_supported_protocol = ?,
        last_seen_at = ?,
        updated_at = ?
      WHERE device_id = ?
    `,
    [
      input.ownerEmail,
      input.displayName,
      input.devicePublicKey,
      input.appVersion,
      input.protocolVersion,
      input.minSupportedProtocol,
      dbTimestamp,
      dbTimestamp,
      input.deviceId,
    ],
  );
}
