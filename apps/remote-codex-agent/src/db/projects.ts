import type {
  ConnectionRecord,
  ConnectionRow,
  ProjectRecord,
  ProjectRow,
  ProjectTreeRecord,
  TelegramThreadBindingRow,
  ThreadRow,
} from "../db";
import {
  db,
  ensureTelegramProjectBindingRow,
  mapConnection,
  mapProject,
  mapThread,
  nowIso,
} from "../db";

function ensureConnectionRow(projectId: number): void {
  const existing = db
    .prepare("SELECT id FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as { id: number } | undefined;

  if (existing) {
    return;
  }

  const timestamp = nowIso();
  db.prepare(
    `
      INSERT INTO project_telegram_connections (
        project_id,
        telegram_chat_id,
        telegram_access_hash,
        telegram_chat_title,
        forum_enabled,
        created_at,
        updated_at
      )
      VALUES (?, NULL, NULL, NULL, 0, ?, ?)
    `,
  ).run(projectId, timestamp, timestamp);
  ensureTelegramProjectBindingRow(projectId);
}

export function listProjectsTree(): ProjectTreeRecord[] {
  const projectRows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC, id DESC").all() as ProjectRow[];

  return projectRows.map((projectRow) => {
    const connection = db
      .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
      .get(projectRow.id) as ConnectionRow | undefined;
    const threadBindings = db
      .prepare("SELECT * FROM telegram_thread_bindings WHERE thread_id IN (SELECT id FROM threads WHERE project_id = ?)")
      .all(projectRow.id) as TelegramThreadBindingRow[];
    const bindingMap = new Map(threadBindings.map((binding) => [binding.thread_id, binding]));
    const threadRows = db
      .prepare("SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC")
      .all(projectRow.id) as ThreadRow[];

    return {
      ...mapProject(projectRow, connection),
      threads: threadRows.map((threadRow) => mapThread(threadRow, bindingMap.get(threadRow.id))),
    };
  });
}

export function getProjectById(projectId: number): ProjectRecord | null {
  const projectRow = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined;
  if (!projectRow) {
    return null;
  }

  const connection = db
    .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as ConnectionRow | undefined;

  return mapProject(projectRow, connection);
}

export function getProjectByTelegramChatId(telegramChatId: string): ProjectRecord | null {
  const row = db
    .prepare(
      `
        SELECT p.*
        FROM projects p
        INNER JOIN project_telegram_connections c
          ON c.project_id = p.id
        WHERE c.telegram_chat_id = ?
      `,
    )
    .get(telegramChatId) as ProjectRow | undefined;

  if (!row) {
    return null;
  }

  return getProjectById(row.id);
}

export function createProject(input: { name: string; folderPath: string }): ProjectRecord {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        INSERT INTO projects (name, folder_path, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `,
    )
    .run(input.name, input.folderPath, timestamp, timestamp);

  const projectId = Number(result.lastInsertRowid);
  ensureConnectionRow(projectId);
  return getProjectById(projectId)!;
}

export function updateProject(projectId: number, input: { name: string; folderPath: string }): ProjectRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        UPDATE projects
        SET name = ?, folder_path = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(input.name, input.folderPath, timestamp, projectId);

  if (result.changes === 0) {
    return null;
  }

  return getProjectById(projectId);
}

export function deleteProject(projectId: number): boolean {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  return result.changes > 0;
}

export function saveProjectTelegramConnection(
  projectId: number,
  input: {
    telegramChatId: string;
    telegramAccessHash: string;
    telegramChatTitle: string;
    forumEnabled: boolean;
  },
): ConnectionRecord {
  ensureConnectionRow(projectId);
  ensureTelegramProjectBindingRow(projectId);
  const timestamp = nowIso();

  db.prepare(
    `
      UPDATE project_telegram_connections
      SET
        telegram_chat_id = ?,
        telegram_access_hash = ?,
        telegram_chat_title = ?,
        forum_enabled = ?,
        updated_at = ?
      WHERE project_id = ?
    `,
  ).run(
    input.telegramChatId,
    input.telegramAccessHash,
    input.telegramChatTitle,
    input.forumEnabled ? 1 : 0,
    timestamp,
    projectId,
  );
  db.prepare(
    `
      UPDATE telegram_project_bindings
      SET
        telegram_chat_id = ?,
        telegram_access_hash = ?,
        telegram_chat_title = ?,
        forum_enabled = ?,
        updated_at = ?
      WHERE project_id = ?
    `,
  ).run(
    input.telegramChatId,
    input.telegramAccessHash,
    input.telegramChatTitle,
    input.forumEnabled ? 1 : 0,
    timestamp,
    projectId,
  );

  const row = db
    .prepare("SELECT * FROM project_telegram_connections WHERE project_id = ?")
    .get(projectId) as ConnectionRow | undefined;

  return mapConnection(row)!;
}
