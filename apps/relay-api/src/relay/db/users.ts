import { randomUUID } from "node:crypto";

import type { Pool, RowDataPacket } from "mysql2/promise";

import { toSqlDateTime } from "../helpers";
import type { RelayUserRow } from "../types";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findRelayUserById(pool: Pool, userId: string): Promise<RelayUserRow | null> {
  const [rows] = await pool.execute<RelayUserRow[]>(
    `
      SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
      FROM relay_users
      WHERE id = ?
      LIMIT 1
    `,
    [userId],
  );
  return rows[0] || null;
}

export async function findRelayUserByIdentity(
  pool: Pool,
  authProvider: string,
  authSubject: string,
): Promise<RelayUserRow | null> {
  const [rows] = await pool.execute<RelayUserRow[]>(
    `
      SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
      FROM relay_users
      WHERE auth_provider = ? AND auth_subject = ?
      LIMIT 1
    `,
    [authProvider, authSubject],
  );
  return rows[0] || null;
}

export async function findRelayUserByCognitoSub(pool: Pool, cognitoSub: string): Promise<RelayUserRow | null> {
  const [rows] = await pool.execute<RelayUserRow[]>(
    `
      SELECT id, auth_provider, auth_subject, auth_issuer, email, password_hash, cognito_sub
      FROM relay_users
      WHERE cognito_sub = ?
      LIMIT 1
    `,
    [cognitoSub],
  );
  return rows[0] || null;
}

export async function findLocalAdminByEmail(pool: Pool, authProvider: string, email: string): Promise<RelayUserRow | null> {
  return findRelayUserByIdentity(pool, authProvider, normalizeEmail(email));
}

export async function createRelayUser(
  pool: Pool,
  input: {
    authProvider: string;
    authSubject: string;
    authIssuer?: string | null;
    email: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  },
): Promise<RelayUserRow> {
  const rowId = randomUUID().replace(/-/g, "");
  const timestamp = toSqlDateTime();
  await pool.execute(
    `
      INSERT INTO relay_users (
        id,
        auth_provider,
        auth_subject,
        auth_issuer,
        email,
        password_hash,
        cognito_sub,
        created_at,
        updated_at,
        last_login_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      rowId,
      input.authProvider,
      input.authSubject,
      input.authIssuer || null,
      normalizeEmail(input.email),
      input.passwordHash || null,
      input.cognitoSub || null,
      timestamp,
      timestamp,
      timestamp,
    ],
  );

  const created = await findRelayUserById(pool, rowId);
  if (!created) {
    throw new Error("Failed to create relay user.");
  }

  return created;
}

export async function updateRelayUser(
  pool: Pool,
  rowId: string,
  input: {
    authProvider?: string;
    authSubject?: string;
    authIssuer?: string | null;
    email?: string;
    passwordHash?: string | null;
    cognitoSub?: string | null;
  },
): Promise<RelayUserRow> {
  const existing = await findRelayUserById(pool, rowId);
  if (!existing) {
    throw new Error("Relay user not found.");
  }

  const timestamp = toSqlDateTime();
  await pool.execute(
    `
      UPDATE relay_users
      SET
        auth_provider = ?,
        auth_subject = ?,
        auth_issuer = ?,
        email = ?,
        password_hash = ?,
        cognito_sub = ?,
        updated_at = ?,
        last_login_at = ?
      WHERE id = ?
    `,
    [
      input.authProvider || existing.auth_provider,
      input.authSubject || existing.auth_subject,
      input.authIssuer === undefined ? existing.auth_issuer : input.authIssuer,
      normalizeEmail(input.email || existing.email),
      input.passwordHash === undefined ? existing.password_hash : input.passwordHash,
      input.cognitoSub === undefined ? existing.cognito_sub || null : input.cognitoSub,
      timestamp,
      timestamp,
      rowId,
    ],
  );

  const updated = await findRelayUserById(pool, rowId);
  if (!updated) {
    throw new Error("Relay user disappeared during update.");
  }

  return updated;
}

export async function hasAnyLocalAdmin(pool: Pool): Promise<boolean> {
  const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>(
    `
      SELECT COUNT(*) AS count
      FROM relay_users
      WHERE auth_provider LIKE 'local-admin:%'
    `,
  );
  return Number(rows[0]?.count || 0) > 0;
}

export async function markUserLogin(pool: Pool, rowId: string): Promise<void> {
  await pool.execute(`UPDATE relay_users SET last_login_at = ?, updated_at = ? WHERE id = ?`, [
    toSqlDateTime(),
    toSqlDateTime(),
    rowId,
  ]);
}
