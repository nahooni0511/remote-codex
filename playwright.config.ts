import path from "node:path";
import { defineConfig } from "@playwright/test";

const portApi = 3300;
const portWeb = 4178;
const e2eDbPath = path.join("/tmp", "remote-codex-e2e", "app.db");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${portWeb}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/start-local-stack.mjs",
      url: `http://127.0.0.1:${portApi}/api/bootstrap`,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        DATABASE_PATH: e2eDbPath,
        AUTO_OPEN_BROWSER: "false",
        WEB_ALLOWED_ORIGIN: `http://127.0.0.1:${portWeb}`,
        PORT: String(portApi),
        REMOTE_CODEX_DISABLE_EXTERNAL_SERVICES: "true",
      },
    },
    {
      command: "npm run dev -w @remote-codex/remote-codex-web -- --host 127.0.0.1 --port 4178",
      url: `http://127.0.0.1:${portWeb}`,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        VITE_DEV_API_TARGET: `http://127.0.0.1:${portApi}`,
      },
    },
  ],
});
