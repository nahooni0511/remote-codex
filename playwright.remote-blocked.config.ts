import path from "node:path";
import { defineConfig } from "@playwright/test";

const relayPort = 3101;
const remoteWebPort = 4175;
const localAgentPort = 3201;
const e2eDbPath = path.join("/tmp", "remote-codex-remote-e2e-blocked", "app.db");
const relayRuntimeEnv = {
  DB_HOST: process.env.DB_HOST || "",
  DB_PORT: process.env.DB_PORT || "",
  DB_NAME: process.env.DB_NAME || "",
  DB_USER: process.env.DB_USER || "",
  DB_PASSWORD: process.env.DB_PASSWORD || "",
  VALKEY_URL: process.env.VALKEY_URL || "",
  COGNITO_REGION: process.env.COGNITO_REGION || "",
  COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || "",
  COGNITO_WEB_CLIENT_ID: process.env.COGNITO_WEB_CLIENT_ID || "",
  RELAY_TEST_AUTH_TOKEN: "remote-e2e-test-token",
  RELAY_TEST_AUTH_EMAIL: process.env.REMOTE_TEST_OWNER_EMAIL || "owner@example.com",
  RELAY_TEST_AUTH_USER_ID: "remote-e2e-owner",
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /remote-blocked\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${remoteWebPort}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/start-remote-stack.mjs",
      url: `http://127.0.0.1:${relayPort}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        REMOTE_TEST_DATABASE_PATH: e2eDbPath,
        REMOTE_TEST_RELAY_PORT: String(relayPort),
        REMOTE_TEST_LOCAL_PORT: String(localAgentPort),
        REMOTE_CODEX_RELAY_PROTOCOL_VERSION: "2.0.0",
        ...relayRuntimeEnv,
      },
    },
    {
      command: `npm run dev -w @remote-codex/relay-web -- --host 127.0.0.1 --port ${remoteWebPort}`,
      url: `http://127.0.0.1:${remoteWebPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_DEV_API_TARGET: `http://127.0.0.1:${relayPort}`,
      },
    },
  ],
});
