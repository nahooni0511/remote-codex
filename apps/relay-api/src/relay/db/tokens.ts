import type { Pool } from "mysql2/promise";

import { fromSqlDateTime, hashToken, toSqlDateTime } from "../helpers";
import type {
  ConnectTokenRecord,
  RelayConnectTokenRow,
  RelayRefreshTokenRow,
} from "../types";

export async function insertRefreshToken(
  pool: Pool,
  input: { expiresAt: string; tokenHash: string; userId: string },
): Promise<void> {
  await pool.execute(
    `
      INSERT INTO relay_refresh_tokens (token_hash, user_id, expires_at, revoked_at, replaced_by_token_hash, created_at)
      VALUES (?, ?, ?, NULL, NULL, ?)
    `,
    [input.tokenHash, input.userId, toSqlDateTime(input.expiresAt), toSqlDateTime()],
  );
}

export async function getRefreshTokenByHash(pool: Pool, tokenHash: string): Promise<RelayRefreshTokenRow | null> {
  const [rows] = await pool.execute<RelayRefreshTokenRow[]>(
    `
      SELECT token_hash, user_id, expires_at, revoked_at, created_at, replaced_by_token_hash
      FROM relay_refresh_tokens
      WHERE token_hash = ?
      LIMIT 1
    `,
    [tokenHash],
  );
  return rows[0] || null;
}

export async function revokeRefreshToken(
  pool: Pool,
  tokenHash: string,
  replacedByTokenHash?: string | null,
): Promise<void> {
  await pool.execute(
    `
      UPDATE relay_refresh_tokens
      SET revoked_at = COALESCE(revoked_at, ?),
          replaced_by_token_hash = COALESCE(replaced_by_token_hash, ?)
      WHERE token_hash = ?
    `,
    [toSqlDateTime(), replacedByTokenHash || null, tokenHash],
  );
}

export async function createConnectTokenRow(pool: Pool, record: ConnectTokenRecord): Promise<void> {
  await pool.execute(
    `
      INSERT INTO relay_connect_tokens (token, owner_user_id, owner_email, device_id, expires_at, used_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?)
    `,
    [record.token, record.userId, record.userEmail, record.deviceId, toSqlDateTime(record.expiresAt), toSqlDateTime()],
  );
}

export async function getConnectTokenRow(pool: Pool, token: string): Promise<ConnectTokenRecord | null> {
  const [rows] = await pool.execute<RelayConnectTokenRow[]>(
    `
      SELECT token, owner_user_id, owner_cognito_sub, owner_email, device_id, expires_at, used_at, created_at
      FROM relay_connect_tokens
      WHERE token = ?
      LIMIT 1
    `,
    [token],
  );
  const row = rows[0];
  if (!row || !row.owner_user_id) {
    return null;
  }

  const expiresAt = fromSqlDateTime(row.expires_at).toISOString();
  return {
    token: row.token,
    userId: row.owner_user_id,
    userEmail: row.owner_email,
    deviceId: row.device_id,
    expiresAt,
  };
}

export async function markConnectTokenUsed(pool: Pool, token: string): Promise<void> {
  await pool.execute(
    `UPDATE relay_connect_tokens SET used_at = COALESCE(used_at, ?) WHERE token = ?`,
    [toSqlDateTime(), token],
  );
}

export async function deleteConnectToken(pool: Pool, token: string): Promise<void> {
  await pool.execute(`DELETE FROM relay_connect_tokens WHERE token = ?`, [token]);
}
