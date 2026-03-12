import path from "node:path";
import { defineConfig } from "@playwright/test";

const portApi = 3000;
const portWeb = 4173;
const snapshotDbPath = path.join("/tmp", "remote-codex-e2e-realdata", "app.db");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /realdata\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${portWeb}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/start-api-realdata.mjs",
      url: `http://127.0.0.1:${portApi}/api/bootstrap`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        DATABASE_PATH: snapshotDbPath,
        PLAYWRIGHT_API_BASE_URL: `http://127.0.0.1:${portApi}`,
        AUTO_OPEN_BROWSER: "false",
        WEB_ALLOWED_ORIGIN: `http://127.0.0.1:${portWeb}`,
        PORT: String(portApi),
        REMOTE_CODEX_DISABLE_EXTERNAL_SERVICES: "true",
      },
    },
    {
      command: "npm run dev -w @remote-codex/web -- --host 127.0.0.1 --port 4173",
      url: `http://127.0.0.1:${portWeb}`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_API_BASE_URL: `http://127.0.0.1:${portApi}`,
        VITE_WS_URL: `ws://127.0.0.1:${portApi}/ws`,
      },
    },
  ],
});
