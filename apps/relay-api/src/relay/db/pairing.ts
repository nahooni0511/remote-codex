import { randomUUID } from "node:crypto";

import type { PairingCodeClaimRequest } from "@remote-codex/contracts";
import type { Pool } from "mysql2/promise";

import { fromSqlDateTime, hashSecret, toSqlDateTime } from "../helpers";
import type { RelayPairingCodeRow } from "../types";

export async function createPairingCodeRow(
  pool: Pool,
  input: {
    code: string;
    ownerUserId: string;
    ownerEmail: string;
    ownerLabel: string;
    expiresAt: string;
  },
): Promise<void> {
  await pool.execute(
    `
      INSERT INTO relay_pairing_codes
        (code, owner_user_id, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `,
    [
      input.code,
      input.ownerUserId,
      input.ownerEmail,
      input.ownerLabel,
      toSqlDateTime(input.expiresAt),
      toSqlDateTime(),
    ],
  );
}

export async function claimPairingCodeWithDevice(
  pool: Pool,
  code: string,
  payload: PairingCodeClaimRequest,
): Promise<{
  deviceId: string;
  deviceSecret: string;
  ownerLabel: string;
  ownerUserId: string;
  ownerCognitoSub: string | null;
}> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RelayPairingCodeRow[]>(
      `
        SELECT code, owner_user_id, owner_cognito_sub, owner_email, owner_label, expires_at, claimed_at, claimed_device_id, created_at
        FROM relay_pairing_codes
        WHERE code = ?
        LIMIT 1
        FOR UPDATE
      `,
      [code],
    );
    const pairingRow = rows[0];
    if (!pairingRow || !pairingRow.owner_user_id) {
      throw new Error("Pairing code not found.");
    }

    if (pairingRow.claimed_at) {
      throw new Error("Pairing code has already been claimed.");
    }

    if (Date.parse(fromSqlDateTime(pairingRow.expires_at).toISOString()) <= Date.now()) {
      throw new Error("Pairing code expired.");
    }

    const timestamp = toSqlDateTime();
    const deviceId = payload.device.localDeviceId;
    const deviceSecret = randomUUID().replace(/-/g, "");

    await connection.execute(
      `
        INSERT INTO relay_devices (
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
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        ON DUPLICATE KEY UPDATE
          owner_user_id = VALUES(owner_user_id),
          owner_cognito_sub = VALUES(owner_cognito_sub),
          owner_email = VALUES(owner_email),
          display_name = VALUES(display_name),
          device_secret_hash = VALUES(device_secret_hash),
          device_public_key = VALUES(device_public_key),
          app_version = VALUES(app_version),
          protocol_version = VALUES(protocol_version),
          min_supported_protocol = VALUES(min_supported_protocol),
          updated_at = VALUES(updated_at)
      `,
      [
        deviceId,
        pairingRow.owner_user_id,
        pairingRow.owner_cognito_sub || null,
        pairingRow.owner_email,
        payload.device.displayName,
        hashSecret(deviceSecret),
        payload.devicePublicKey,
        payload.device.appVersion,
        payload.protocolVersion,
        payload.minSupportedProtocol,
        timestamp,
        timestamp,
      ],
    );

    await connection.execute(
      `
        UPDATE relay_pairing_codes
        SET claimed_at = ?, claimed_device_id = ?
        WHERE code = ?
      `,
      [timestamp, deviceId, code],
    );

    await connection.commit();

    return {
      deviceId,
      deviceSecret,
      ownerLabel: pairingRow.owner_label,
      ownerUserId: pairingRow.owner_user_id,
      ownerCognitoSub: pairingRow.owner_cognito_sub || null,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
