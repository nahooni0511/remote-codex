import type { Pool } from "mysql2/promise";

import { toSqlDateTime } from "../helpers";

export async function writeAuditLog(
  pool: Pool,
  action: string,
  input: {
    actorUserId?: string | null;
    actorCognitoSub?: string | null;
    deviceId?: string | null;
    payloadJson?: string | null;
  } = {},
): Promise<void> {
  const timestamp = toSqlDateTime();
  await pool.execute(
    `
      INSERT INTO relay_audit_logs (actor_user_id, actor_cognito_sub, device_id, action, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      input.actorUserId || null,
      input.actorCognitoSub || null,
      input.deviceId || null,
      action,
      input.payloadJson || null,
      timestamp,
    ],
  );
}
