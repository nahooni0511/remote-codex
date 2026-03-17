import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import Database from "better-sqlite3";

const repoRoot = process.cwd();
const relayPort = Number(process.env.REMOTE_TEST_RELAY_PORT || 3100);
const localAgentPort = Number(process.env.REMOTE_TEST_LOCAL_PORT || 3200);
const dbPath = process.env.REMOTE_TEST_DATABASE_PATH;
const ownerEmail = process.env.REMOTE_TEST_OWNER_EMAIL || "owner@example.com";

if (!dbPath) {
  throw new Error("REMOTE_TEST_DATABASE_PATH is required for remote e2e startup.");
}

function getTsxPath() {
  return path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
}

function delay(timeMs) {
  return new Promise((resolve) => setTimeout(resolve, timeMs));
}

async function waitForJson(url, options = {}, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function waitForCondition(check, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(300);
  }

  throw lastError || new Error("Timed out waiting for startup condition.");
}

function seedDatabase() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.rmSync(dbPath, { force: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, folder_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE project_telegram_connections (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL UNIQUE, telegram_chat_id TEXT, telegram_access_hash TEXT, telegram_chat_title TEXT, forum_enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE threads (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, title TEXT NOT NULL, telegram_topic_id INTEGER NOT NULL, telegram_topic_name TEXT, codex_thread_id TEXT, codex_model_override TEXT, codex_reasoning_effort_override TEXT, origin TEXT NOT NULL DEFAULT 'app', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web', sender_name TEXT, sender_telegram_user_id TEXT, telegram_message_id INTEGER, error_text TEXT, attachment_kind TEXT, attachment_path TEXT, attachment_mime_type TEXT, attachment_filename TEXT, created_at TEXT NOT NULL, FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE);
    CREATE TABLE cron_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL, cron_expr TEXT NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, codex_thread_id TEXT, last_run_at TEXT, last_run_status TEXT, next_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE);
    CREATE TABLE cron_job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, cron_job_id INTEGER NOT NULL, status TEXT NOT NULL, started_at TEXT, finished_at TEXT, notify_sent INTEGER NOT NULL DEFAULT 0, error_text TEXT, created_at TEXT NOT NULL, FOREIGN KEY (cron_job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE);
  `);

  const now = new Date().toISOString();
  const setSetting = db.prepare("INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)");
  [
    ["codex_response_language", "Korean"],
    ["codex_default_model", "gpt-5.4"],
    ["codex_default_reasoning_effort", "medium"],
  ].forEach(([key, value]) => setSetting.run(key, value, now));

  const insertProject = db.prepare(
    "INSERT INTO projects (name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const insertThread = db.prepare(
    "INSERT INTO threads (project_id, title, telegram_topic_id, telegram_topic_name, codex_thread_id, origin, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMessage = db.prepare(
    "INSERT INTO messages (thread_id, role, content, source, sender_name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );

  const projectId = Number(insertProject.run("Remote Relay Workspace", repoRoot, now, now).lastInsertRowid);
  const mainThreadId = Number(
    insertThread.run(projectId, "Relay verification", 1001, "Relay verification", "relay-thread-1", "app", "open", now, now)
      .lastInsertRowid,
  );
  const secondThreadId = Number(
    insertThread.run(projectId, "Encrypted bridge", 1002, "Encrypted bridge", "relay-thread-2", "app", "open", now, now)
      .lastInsertRowid,
  );

  insertMessage.run(mainThreadId, "user", "remote relay 연결이 제대로 되는지 확인해줘.", "web", "Remote Owner", now);
  insertMessage.run(
    mainThreadId,
    "assistant",
    "relay를 통해 로컬 워크스페이스가 정상적으로 노출되고 있습니다.",
    "codex",
    "Codex",
    now,
  );
  insertMessage.run(
    secondThreadId,
    "assistant",
    "평문은 relay에 남기지 않고 암호화된 envelope만 전달합니다.",
    "codex",
    "Codex",
    now,
  );

  db.close();
}

function spawnService(label, entryFile, env) {
  const child = spawn(getTsxPath(), [entryFile], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  return child;
}

const children = [];

function shutdown(signal) {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

seedDatabase();

children.push(
  spawnService("relay-api", "apps/relay-api/src/index.ts", {
    PORT: String(relayPort),
  }),
);

children.push(
  spawnService("remote-codex-agent", "apps/remote-codex-agent/src/index.ts", {
    DATABASE_PATH: dbPath,
    PORT: String(localAgentPort),
    AUTO_OPEN_BROWSER: "false",
    REMOTE_CODEX_DISABLE_EXTERNAL_SERVICES: "true",
  }),
);

await waitForJson(`http://127.0.0.1:${relayPort}/api/health`);
await waitForJson(`http://127.0.0.1:${localAgentPort}/api/bootstrap`);

await waitForJson(`http://127.0.0.1:${localAgentPort}/api/integrations/global`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    enabled: true,
    deviceId: "remote-e2e-device",
    deviceSecret: "remote-e2e-secret",
    ownerLabel: ownerEmail,
    serverUrl: `http://127.0.0.1:${relayPort}`,
    wsUrl: `ws://127.0.0.1:${relayPort}/ws/bridge`,
  }),
});

await waitForCondition(async () => {
  const result = await waitForJson(`http://127.0.0.1:${localAgentPort}/api/integrations`);
  return result.global?.connected ? result : null;
});

await new Promise(() => {});
