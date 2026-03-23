import { db } from "./core";

db.exec(`
  CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_telegram_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    telegram_chat_id TEXT,
    telegram_access_hash TEXT,
    telegram_chat_title TEXT,
    forum_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    telegram_topic_id INTEGER NOT NULL,
    telegram_topic_name TEXT,
    codex_thread_id TEXT,
    codex_model_override TEXT,
    codex_reasoning_effort_override TEXT,
    default_mode TEXT NOT NULL DEFAULT 'default',
    codex_permission_mode TEXT NOT NULL DEFAULT 'default',
    origin TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    sender_name TEXT,
    sender_telegram_user_id TEXT,
    telegram_message_id INTEGER,
    error_text TEXT,
    attachment_kind TEXT,
    attachment_path TEXT,
    attachment_mime_type TEXT,
    attachment_filename TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS device_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    local_device_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    host_name TEXT NOT NULL,
    os TEXT NOT NULL,
    platform TEXT NOT NULL,
    app_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS global_pairing (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    device_id TEXT,
    device_secret TEXT,
    owner_label TEXT,
    server_url TEXT,
    ws_url TEXT,
    connected INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_project_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    telegram_chat_id TEXT,
    telegram_access_hash TEXT,
    telegram_chat_title TEXT,
    forum_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS telegram_thread_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL UNIQUE,
    telegram_topic_id INTEGER NOT NULL,
    telegram_topic_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS message_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_message_id INTEGER UNIQUE,
    thread_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    origin_channel TEXT NOT NULL,
    origin_actor TEXT,
    display_hints_json TEXT NOT NULL,
    error_text TEXT,
    attachment_kind TEXT,
    attachment_path TEXT,
    attachment_mime_type TEXT,
    attachment_filename TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (legacy_message_id) REFERENCES messages(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS message_event_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS telegram_message_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    thread_id INTEGER NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(thread_id, telegram_message_id),
    FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE CASCADE,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cron_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cron_expr TEXT NOT NULL,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    codex_thread_id TEXT,
    last_run_at TEXT,
    last_run_status TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cron_job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cron_job_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    notify_sent INTEGER NOT NULL DEFAULT 0,
    error_text TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (cron_job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS codex_turn_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    mode TEXT NOT NULL,
    model_id TEXT NOT NULL,
    reasoning_effort TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    branch_at_start TEXT,
    branch_at_end TEXT,
    repo_clean_at_start INTEGER NOT NULL DEFAULT 0,
    undo_state TEXT NOT NULL DEFAULT 'not_available',
    explored_files_count INTEGER,
    changed_files_json TEXT,
    repo_status_after TEXT,
    summary_event_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (summary_event_id) REFERENCES message_events(id) ON DELETE SET NULL
  );
`);

function ensureColumnExists(tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

ensureColumnExists("messages", "attachment_kind", "TEXT");
ensureColumnExists("messages", "attachment_path", "TEXT");
ensureColumnExists("messages", "attachment_mime_type", "TEXT");
ensureColumnExists("messages", "attachment_filename", "TEXT");
ensureColumnExists("threads", "codex_thread_id", "TEXT");
ensureColumnExists("threads", "codex_model_override", "TEXT");
ensureColumnExists("threads", "codex_reasoning_effort_override", "TEXT");
ensureColumnExists("threads", "default_mode", "TEXT NOT NULL DEFAULT 'default'");
ensureColumnExists("threads", "codex_permission_mode", "TEXT NOT NULL DEFAULT 'default'");
ensureColumnExists("message_events", "payload_json", "TEXT");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_project_topic_unique ON threads(project_id, telegram_topic_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_message_events_thread_id ON message_events(thread_id);
  CREATE INDEX IF NOT EXISTS idx_message_event_deliveries_event_id ON message_event_deliveries(event_id);
  CREATE INDEX IF NOT EXISTS idx_codex_turn_runs_thread_id ON codex_turn_runs(thread_id);
  CREATE INDEX IF NOT EXISTS idx_codex_turn_runs_summary_event_id ON codex_turn_runs(summary_event_id);
  CREATE INDEX IF NOT EXISTS idx_telegram_project_bindings_project_id ON telegram_project_bindings(project_id);
  CREATE INDEX IF NOT EXISTS idx_telegram_thread_bindings_thread_id ON telegram_thread_bindings(thread_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_telegram_message_unique
    ON messages(thread_id, telegram_message_id)
    WHERE telegram_message_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_message_refs_thread_message_unique
    ON telegram_message_refs(thread_id, telegram_message_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_thread_id ON cron_jobs(thread_id);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_enabled ON cron_jobs(enabled);
  CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run_at ON cron_jobs(next_run_at);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_cron_job_id ON cron_job_runs(cron_job_id);
  CREATE INDEX IF NOT EXISTS idx_cron_job_runs_status ON cron_job_runs(status);
`);
