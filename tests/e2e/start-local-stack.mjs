import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH;

if (!dbPath) {
  throw new Error("DATABASE_PATH is required for e2e api startup.");
}

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
const set = db.prepare("INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)");
[
  ["telegram_api_id", "123456"],
  ["telegram_api_hash", "fakehash"],
  ["telegram_phone_number", "+821012345678"],
  ["telegram_session_string", "fake-session"],
  ["telegram_user_name", "E2E User"],
  ["telegram_bot_token", "123:fake-token"],
  ["telegram_bot_user_id", "999999"],
  ["telegram_bot_username", "remote_codex_bot"],
  ["codex_response_language", "Korean"],
  ["codex_default_model", "gpt-5.4"],
  ["codex_default_reasoning_effort", "medium"],
].forEach(([key, value]) => set.run(key, value, now));

const repoRoot = process.cwd();
const insertProject = db.prepare("INSERT INTO projects (name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)");
const insertConnection = db.prepare("INSERT INTO project_telegram_connections (project_id, telegram_chat_id, telegram_access_hash, telegram_chat_title, forum_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const insertThread = db.prepare("INSERT INTO threads (project_id, title, telegram_topic_id, telegram_topic_name, codex_thread_id, origin, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
const insertMessage = db.prepare("INSERT INTO messages (thread_id, role, content, source, sender_name, created_at) VALUES (?, ?, ?, ?, ?, ?)");
const insertCron = db.prepare("INSERT INTO cron_jobs (thread_id, name, prompt, cron_expr, timezone, enabled, last_run_at, last_run_status, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

const project1 = Number(insertProject.run("Remote Codex", repoRoot, now, now).lastInsertRowid);
insertConnection.run(project1, "-10001", "accesshash1", "Remote Codex Group", 1, now, now);
const project2 = Number(insertProject.run("Automation Lab", repoRoot, now, now).lastInsertRowid);
insertConnection.run(project2, "-10002", "accesshash2", "Automation Lab Group", 1, now, now);

const thread1 = Number(insertThread.run(project1, "Main thread", 101, "Main thread", "runtime-thread-1", "app", "open", now, now).lastInsertRowid);
const thread2 = Number(insertThread.run(project1, "Bug triage", 102, "Bug triage", "runtime-thread-2", "telegram", "open", now, now).lastInsertRowid);
const thread3 = Number(insertThread.run(project2, "Daily cron", 201, "Daily cron", "runtime-thread-3", "app", "open", now, now).lastInsertRowid);

insertMessage.run(thread1, "user", "현재 프로젝트 구조를 점검해줘.", "web", "E2E User", now);
insertMessage.run(thread1, "assistant", "구조를 점검했고, local-web와 local-agent를 분리하는 편이 유지보수에 유리합니다.", "codex", "Codex", now);
insertMessage.run(thread2, "system", "Codex 진행\n\n브랜치를 스캔하는 중입니다.", "codex", "Codex", now);
insertMessage.run(thread2, "assistant", "수정이 필요한 파일은 3개입니다.", "telegram", "Reviewer", now);
insertMessage.run(thread3, "user", "매일 오전 9시에 상태 점검을 실행해줘.", "cron", "Cron Job", now);

insertCron.run(thread3, "Morning status", "Summarize overnight changes", "0 9 * * *", "Asia/Seoul", 1, now, "success", new Date(Date.now() + 3_600_000).toISOString(), now, now);
insertCron.run(thread2, "Bug sweep", "List open regressions", "0 */2 * * *", "Asia/Seoul", 0, now, "failed", null, now, now);
db.close();

const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["apps/remote-codex-agent/src/index.ts"], {
  stdio: "inherit",
  env: process.env,
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
