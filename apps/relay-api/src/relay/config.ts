import type { RelayStoreConfig } from "./types";

export const CONNECT_TOKEN_TTL_MS = 5 * 60_000;
export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PRESENCE_TTL_SECONDS = 90;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const DEVICE_CHANNEL = "rc:ws:device";
export const CLIENT_CHANNEL = "rc:ws:client";
export const RPC_RESPONSE_CHANNEL = "rc:rpc:response";

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function getRequiredEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback || "";
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function loadRelayStoreConfig(port: number): RelayStoreConfig {
  return {
    port,
    databaseHost: getRequiredEnv("DB_HOST"),
    databasePort: Number(getRequiredEnv("DB_PORT", "3306")),
    databaseName: getRequiredEnv("DB_NAME", "remote-codex"),
    databaseUser: getRequiredEnv("DB_USER"),
    databasePassword: getRequiredEnv("DB_PASSWORD"),
    valkeyUrl: getRequiredEnv("VALKEY_URL"),
    cognitoRegion: getRequiredEnv("COGNITO_REGION", process.env.AWS_REGION),
    cognitoUserPoolId: getRequiredEnv("COGNITO_USER_POOL_ID"),
    cognitoWebClientId: getRequiredEnv("COGNITO_WEB_CLIENT_ID"),
    testAuthToken: getOptionalEnv("RELAY_TEST_AUTH_TOKEN"),
    testAuthEmail: getOptionalEnv("RELAY_TEST_AUTH_EMAIL"),
    testAuthUserId: getOptionalEnv("RELAY_TEST_AUTH_USER_ID"),
  };
}
