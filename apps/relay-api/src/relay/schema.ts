import type { Pool } from "mysql2/promise";

export async function ensureRelaySchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_users (
      cognito_sub VARCHAR(191) PRIMARY KEY,
      email VARCHAR(320) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_devices (
      device_id VARCHAR(191) PRIMARY KEY,
      owner_cognito_sub VARCHAR(191) NOT NULL,
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
      INDEX relay_devices_owner_idx (owner_cognito_sub),
      CONSTRAINT relay_devices_owner_fk
        FOREIGN KEY (owner_cognito_sub) REFERENCES relay_users (cognito_sub)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_pairing_codes (
      code VARCHAR(32) PRIMARY KEY,
      owner_cognito_sub VARCHAR(191) NOT NULL,
      owner_email VARCHAR(320) NOT NULL,
      owner_label VARCHAR(255) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      claimed_at DATETIME(3) NULL,
      claimed_device_id VARCHAR(191) NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX relay_pairing_codes_owner_idx (owner_cognito_sub),
      CONSTRAINT relay_pairing_codes_owner_fk
        FOREIGN KEY (owner_cognito_sub) REFERENCES relay_users (cognito_sub)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_connect_tokens (
      token VARCHAR(191) PRIMARY KEY,
      owner_cognito_sub VARCHAR(191) NOT NULL,
      owner_email VARCHAR(320) NOT NULL,
      device_id VARCHAR(191) NOT NULL,
      expires_at DATETIME(3) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      INDEX relay_connect_tokens_owner_idx (owner_cognito_sub),
      INDEX relay_connect_tokens_device_idx (device_id),
      CONSTRAINT relay_connect_tokens_owner_fk
        FOREIGN KEY (owner_cognito_sub) REFERENCES relay_users (cognito_sub)
        ON DELETE CASCADE,
      CONSTRAINT relay_connect_tokens_device_fk
        FOREIGN KEY (device_id) REFERENCES relay_devices (device_id)
        ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_cognito_sub VARCHAR(191) NULL,
      device_id VARCHAR(191) NULL,
      action VARCHAR(128) NOT NULL,
      payload_json LONGTEXT NULL,
      created_at DATETIME(3) NOT NULL
    )
  `);
}
