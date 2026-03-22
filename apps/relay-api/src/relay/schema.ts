import type { Pool, RowDataPacket } from "mysql2/promise";

import { toSqlDateTime } from "./helpers";

async function columnExists(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function indexExists(pool: Pool, tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName]);
  return rows.length > 0;
}

async function constraintExists(pool: Pool, tableName: string, constraintName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
      LIMIT 1
    `,
    [tableName, constraintName],
  );
  return rows.length > 0;
}

async function getPrimaryKeyColumn(pool: Pool, tableName: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`);
  return rows[0]?.Column_name || null;
}

async function addColumnIfMissing(pool: Pool, tableName: string, columnName: string, definition: string): Promise<void> {
  if (await columnExists(pool, tableName, columnName)) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
}

async function addIndexIfMissing(pool: Pool, tableName: string, indexName: string, definition: string): Promise<void> {
  if (await indexExists(pool, tableName, indexName)) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`);
}

async function dropConstraintIfExists(pool: Pool, tableName: string, constraintName: string): Promise<void> {
  if (!(await constraintExists(pool, tableName, constraintName))) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``);
}

async function addConstraintIfMissing(pool: Pool, tableName: string, constraintName: string, definition: string): Promise<void> {
  if (await constraintExists(pool, tableName, constraintName)) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` ${definition}`);
}

export async function ensureRelaySchema(
  pool: Pool,
  options: {
    defaultOidcIssuer: string | null;
  },
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_users (
      id VARCHAR(191) PRIMARY KEY,
      auth_provider VARCHAR(64) NOT NULL,
      auth_subject VARCHAR(191) NOT NULL,
      auth_issuer VARCHAR(512) NULL,
      email VARCHAR(320) NOT NULL,
      password_hash TEXT NULL,
      cognito_sub VARCHAR(191) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      last_login_at DATETIME(3) NULL,
      UNIQUE KEY relay_users_auth_identity (auth_provider, auth_subject),
      UNIQUE KEY relay_users_cognito_sub_unique (cognito_sub)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_devices (
      device_id VARCHAR(191) PRIMARY KEY,
      owner_user_id VARCHAR(191) NULL,
      owner_cognito_sub VARCHAR(191) NULL,
      owner_email VARCHAR(320) NULL,
      display_name VARCHAR(255) NOT NULL,
      device_secret_hash CHAR(64) NOT NULL,
      device_public_key TEXT NULL,
      app_version VARCHAR(64) NOT NULL,
      protocol_version VARCHAR(64) NOT NULL,
      min_supported_protocol VARCHAR(64) NOT NULL,
      last_seen_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX relay_devices_owner_user_idx (owner_user_id),
      INDEX relay_devices_owner_cognito_idx (owner_cognito_sub),
      CONSTRAINT relay_devices_owner_user_fk
        FOREIGN KEY (owner_user_id) REFERENCES relay_users (id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_pairing_codes (
      code VARCHAR(32) PRIMARY KEY,
      owner_user_id VARCHAR(191) NULL,
      owner_cognito_sub VARCHAR(191) NULL,
      owner_email VARCHAR(320) NOT NULL,
      owner_label VARCHAR(255) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      claimed_at DATETIME(3) NULL,
      claimed_device_id VARCHAR(191) NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX relay_pairing_codes_owner_user_idx (owner_user_id),
      INDEX relay_pairing_codes_owner_cognito_idx (owner_cognito_sub),
      CONSTRAINT relay_pairing_codes_owner_user_fk
        FOREIGN KEY (owner_user_id) REFERENCES relay_users (id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_connect_tokens (
      token VARCHAR(191) PRIMARY KEY,
      owner_user_id VARCHAR(191) NULL,
      owner_cognito_sub VARCHAR(191) NULL,
      owner_email VARCHAR(320) NOT NULL,
      device_id VARCHAR(191) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX relay_connect_tokens_owner_user_idx (owner_user_id),
      INDEX relay_connect_tokens_owner_cognito_idx (owner_cognito_sub),
      INDEX relay_connect_tokens_device_idx (device_id),
      CONSTRAINT relay_connect_tokens_owner_user_fk
        FOREIGN KEY (owner_user_id) REFERENCES relay_users (id)
        ON DELETE CASCADE,
      CONSTRAINT relay_connect_tokens_device_fk
        FOREIGN KEY (device_id) REFERENCES relay_devices (device_id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_refresh_tokens (
      token_hash CHAR(64) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      revoked_at DATETIME(3) NULL,
      replaced_by_token_hash CHAR(64) NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX relay_refresh_tokens_user_idx (user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_user_id VARCHAR(191) NULL,
      actor_cognito_sub VARCHAR(191) NULL,
      device_id VARCHAR(191) NULL,
      action VARCHAR(128) NOT NULL,
      payload_json LONGTEXT NULL,
      created_at DATETIME(3) NOT NULL
    )
  `);

  await addColumnIfMissing(pool, "relay_users", "id", "`id` VARCHAR(191) NULL FIRST");
  await addColumnIfMissing(pool, "relay_users", "auth_provider", "`auth_provider` VARCHAR(64) NULL AFTER `id`");
  await addColumnIfMissing(pool, "relay_users", "auth_subject", "`auth_subject` VARCHAR(191) NULL AFTER `auth_provider`");
  await addColumnIfMissing(pool, "relay_users", "auth_issuer", "`auth_issuer` VARCHAR(512) NULL AFTER `auth_subject`");
  await addColumnIfMissing(pool, "relay_users", "password_hash", "`password_hash` TEXT NULL AFTER `email`");
  await addColumnIfMissing(pool, "relay_users", "cognito_sub", "`cognito_sub` VARCHAR(191) NULL AFTER `password_hash`");
  await addColumnIfMissing(pool, "relay_users", "last_login_at", "`last_login_at` DATETIME(3) NULL AFTER `updated_at`");

  await addColumnIfMissing(pool, "relay_devices", "owner_user_id", "`owner_user_id` VARCHAR(191) NULL AFTER `device_id`");
  await addColumnIfMissing(pool, "relay_devices", "owner_cognito_sub", "`owner_cognito_sub` VARCHAR(191) NULL AFTER `owner_user_id`");

  await addColumnIfMissing(pool, "relay_pairing_codes", "owner_user_id", "`owner_user_id` VARCHAR(191) NULL AFTER `code`");
  await addColumnIfMissing(pool, "relay_pairing_codes", "owner_cognito_sub", "`owner_cognito_sub` VARCHAR(191) NULL AFTER `owner_user_id`");

  await addColumnIfMissing(pool, "relay_connect_tokens", "owner_user_id", "`owner_user_id` VARCHAR(191) NULL AFTER `token`");
  await addColumnIfMissing(pool, "relay_connect_tokens", "owner_cognito_sub", "`owner_cognito_sub` VARCHAR(191) NULL AFTER `owner_user_id`");

  await addColumnIfMissing(pool, "relay_audit_logs", "actor_user_id", "`actor_user_id` VARCHAR(191) NULL AFTER `id`");
  await addColumnIfMissing(pool, "relay_audit_logs", "actor_cognito_sub", "`actor_cognito_sub` VARCHAR(191) NULL AFTER `actor_user_id`");

  await pool.query(`UPDATE relay_users SET id = REPLACE(UUID(), '-', '') WHERE id IS NULL OR id = ''`);
  if (await columnExists(pool, "relay_users", "cognito_sub")) {
    const timestamp = toSqlDateTime();
    await pool.execute(
      `
        UPDATE relay_users
        SET
          auth_provider = COALESCE(NULLIF(auth_provider, ''), 'oidc'),
          auth_subject = COALESCE(NULLIF(auth_subject, ''), NULLIF(cognito_sub, ''), id),
          auth_issuer = COALESCE(NULLIF(auth_issuer, ''), ?),
          updated_at = COALESCE(updated_at, ?, created_at)
        WHERE auth_provider IS NULL
           OR auth_provider = ''
           OR auth_subject IS NULL
           OR auth_subject = ''
      `,
      [options.defaultOidcIssuer, timestamp],
    );
    await pool.query(`UPDATE relay_users SET cognito_sub = auth_subject WHERE (cognito_sub IS NULL OR cognito_sub = '') AND auth_provider = 'oidc'`);
  }

  await pool.query(`
    UPDATE relay_devices AS d
    JOIN relay_users AS u ON u.cognito_sub = d.owner_cognito_sub
    SET d.owner_user_id = u.id
    WHERE d.owner_user_id IS NULL AND d.owner_cognito_sub IS NOT NULL
  `);
  await pool.query(`
    UPDATE relay_pairing_codes AS p
    JOIN relay_users AS u ON u.cognito_sub = p.owner_cognito_sub
    SET p.owner_user_id = u.id
    WHERE p.owner_user_id IS NULL AND p.owner_cognito_sub IS NOT NULL
  `);
  await pool.query(`
    UPDATE relay_connect_tokens AS t
    JOIN relay_users AS u ON u.cognito_sub = t.owner_cognito_sub
    SET t.owner_user_id = u.id
    WHERE t.owner_user_id IS NULL AND t.owner_cognito_sub IS NOT NULL
  `);
  await pool.query(`
    UPDATE relay_audit_logs AS l
    JOIN relay_users AS u ON u.cognito_sub = l.actor_cognito_sub
    SET l.actor_user_id = u.id
    WHERE l.actor_user_id IS NULL AND l.actor_cognito_sub IS NOT NULL
  `);

  await addIndexIfMissing(pool, "relay_users", "relay_users_auth_identity", "UNIQUE INDEX `relay_users_auth_identity` (`auth_provider`, `auth_subject`)");
  await addIndexIfMissing(pool, "relay_users", "relay_users_cognito_sub_unique", "UNIQUE INDEX `relay_users_cognito_sub_unique` (`cognito_sub`)");
  await addIndexIfMissing(pool, "relay_devices", "relay_devices_owner_user_idx", "INDEX `relay_devices_owner_user_idx` (`owner_user_id`)");
  await addIndexIfMissing(pool, "relay_pairing_codes", "relay_pairing_codes_owner_user_idx", "INDEX `relay_pairing_codes_owner_user_idx` (`owner_user_id`)");
  await addIndexIfMissing(pool, "relay_connect_tokens", "relay_connect_tokens_owner_user_idx", "INDEX `relay_connect_tokens_owner_user_idx` (`owner_user_id`)");
  await addIndexIfMissing(pool, "relay_audit_logs", "relay_audit_logs_actor_user_idx", "INDEX `relay_audit_logs_actor_user_idx` (`actor_user_id`)");

  await dropConstraintIfExists(pool, "relay_devices", "relay_devices_owner_fk");
  await dropConstraintIfExists(pool, "relay_pairing_codes", "relay_pairing_codes_owner_fk");
  await dropConstraintIfExists(pool, "relay_connect_tokens", "relay_connect_tokens_owner_fk");

  const primaryKeyColumn = await getPrimaryKeyColumn(pool, "relay_users");
  if (primaryKeyColumn !== "id") {
    await pool.query(`
      ALTER TABLE relay_users
      MODIFY COLUMN id VARCHAR(191) NOT NULL,
      DROP PRIMARY KEY,
      ADD PRIMARY KEY (id)
    `);
  }

  await pool.query(`ALTER TABLE relay_users MODIFY COLUMN cognito_sub VARCHAR(191) NULL`);

  await addConstraintIfMissing(
    pool,
    "relay_devices",
    "relay_devices_owner_user_fk",
    "FOREIGN KEY (`owner_user_id`) REFERENCES `relay_users` (`id`) ON DELETE CASCADE",
  );
  await addConstraintIfMissing(
    pool,
    "relay_pairing_codes",
    "relay_pairing_codes_owner_user_fk",
    "FOREIGN KEY (`owner_user_id`) REFERENCES `relay_users` (`id`) ON DELETE CASCADE",
  );
  await addConstraintIfMissing(
    pool,
    "relay_connect_tokens",
    "relay_connect_tokens_owner_user_fk",
    "FOREIGN KEY (`owner_user_id`) REFERENCES `relay_users` (`id`) ON DELETE CASCADE",
  );
  await addConstraintIfMissing(
    pool,
    "relay_refresh_tokens",
    "relay_refresh_tokens_user_fk",
    "FOREIGN KEY (`user_id`) REFERENCES `relay_users` (`id`) ON DELETE CASCADE",
  );
}
