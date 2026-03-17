import type {
  CronJobListItem,
  CronJobListRow,
  CronJobRecord,
  CronJobRow,
  CronJobRunRecord,
  CronJobRunRow,
} from "../db";
import { db, getThreadById, mapCronJob, mapCronJobListItem, mapCronJobRun, nowIso } from "../db";

export function createCronJob(input: {
  threadId: number;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone: string;
  enabled?: boolean;
  codexThreadId?: string | null;
  nextRunAt?: string | null;
}): CronJobRecord {
  const timestamp = nowIso();
  const result = db.prepare(
    `
      INSERT INTO cron_jobs (
        thread_id,
        name,
        prompt,
        cron_expr,
        timezone,
        enabled,
        codex_thread_id,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.threadId,
    input.name,
    input.prompt,
    input.cronExpr,
    input.timezone,
    input.enabled === false ? 0 : 1,
    input.codexThreadId ?? null,
    input.nextRunAt ?? null,
    timestamp,
    timestamp,
  );

  const thread = getThreadById(input.threadId);
  if (thread) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(timestamp, thread.projectId);
  }

  return getCronJobById(Number(result.lastInsertRowid))!;
}

export function getCronJobById(jobId: number): CronJobRecord | null {
  const row = db.prepare("SELECT * FROM cron_jobs WHERE id = ?").get(jobId) as CronJobRow | undefined;
  return row ? mapCronJob(row) : null;
}

function listCronJobsInternal(whereClause = "", values: unknown[] = []): CronJobListItem[] {
  const rows = db.prepare(
    `
      SELECT
        cj.*,
        t.project_id,
        p.name AS project_name,
        t.title AS thread_title,
        EXISTS(
          SELECT 1
          FROM cron_job_runs cjr
          WHERE cjr.cron_job_id = cj.id
            AND cjr.status = 'running'
            AND cjr.finished_at IS NULL
        ) AS running
      FROM cron_jobs cj
      INNER JOIN threads t ON t.id = cj.thread_id
      INNER JOIN projects p ON p.id = t.project_id
      ${whereClause}
      ORDER BY p.updated_at DESC, t.updated_at DESC, cj.created_at DESC, cj.id DESC
    `,
  ).all(...values) as CronJobListRow[];

  return rows.map(mapCronJobListItem);
}

export function listCronJobs(): CronJobListItem[] {
  return listCronJobsInternal();
}

export function listCronJobsByThread(threadId: number): CronJobListItem[] {
  return listCronJobsInternal("WHERE cj.thread_id = ?", [threadId]);
}

export function updateCronJobEnabled(jobId: number, enabled: boolean): CronJobRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare("UPDATE cron_jobs SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, timestamp, jobId);

  if (result.changes === 0) {
    return null;
  }

  return getCronJobById(jobId);
}

export function updateCronJobCodexThreadId(jobId: number, codexThreadId: string | null): CronJobRecord | null {
  const timestamp = nowIso();
  const result = db
    .prepare("UPDATE cron_jobs SET codex_thread_id = ?, updated_at = ? WHERE id = ?")
    .run(codexThreadId, timestamp, jobId);

  if (result.changes === 0) {
    return null;
  }

  return getCronJobById(jobId);
}

export function refreshCronJobNextRunAt(
  jobId: number,
  input: {
    nextRunAt?: string | null;
    lastRunAt?: string | null;
    lastRunStatus?: string | null;
  },
): CronJobRecord | null {
  const existing = getCronJobById(jobId);
  if (!existing) {
    return null;
  }

  const timestamp = nowIso();
  const nextRunAt = input.nextRunAt === undefined ? existing.nextRunAt : input.nextRunAt;
  const lastRunAt = input.lastRunAt === undefined ? existing.lastRunAt : input.lastRunAt;
  const lastRunStatus = input.lastRunStatus === undefined ? existing.lastRunStatus : input.lastRunStatus;

  db.prepare(
    `
      UPDATE cron_jobs
      SET next_run_at = ?, last_run_at = ?, last_run_status = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(nextRunAt, lastRunAt, lastRunStatus, timestamp, jobId);

  return getCronJobById(jobId);
}

export function deleteCronJob(jobId: number): boolean {
  const job = getCronJobById(jobId);
  if (!job) {
    return false;
  }

  const result = db.prepare("DELETE FROM cron_jobs WHERE id = ?").run(jobId);
  if (result.changes === 0) {
    return false;
  }

  const thread = getThreadById(job.threadId);
  if (thread) {
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(nowIso(), thread.projectId);
  }

  return true;
}

export function createCronJobRun(input: {
  cronJobId: number;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  notifySent?: boolean;
  errorText?: string | null;
}): CronJobRunRecord {
  const createdAt = nowIso();
  const result = db.prepare(
    `
      INSERT INTO cron_job_runs (
        cron_job_id,
        status,
        started_at,
        finished_at,
        notify_sent,
        error_text,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    input.cronJobId,
    input.status,
    input.startedAt ?? null,
    input.finishedAt ?? null,
    input.notifySent ? 1 : 0,
    input.errorText ?? null,
    createdAt,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(Number(result.lastInsertRowid)) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function touchCronJobRunState(
  runId: number,
  input: {
    status?: string;
    notifySent?: boolean;
    errorText?: string | null;
  },
): CronJobRunRecord | null {
  const existing = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE cron_job_runs
      SET status = ?, notify_sent = ?, error_text = ?
      WHERE id = ?
    `,
  ).run(
    input.status ?? existing.status,
    input.notifySent === undefined ? existing.notify_sent : input.notifySent ? 1 : 0,
    input.errorText === undefined ? existing.error_text : input.errorText,
    runId,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function finishCronJobRun(
  runId: number,
  input: {
    status: string;
    finishedAt?: string | null;
    notifySent?: boolean;
    errorText?: string | null;
  },
): CronJobRunRecord | null {
  const existing = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow | undefined;
  if (!existing) {
    return null;
  }

  db.prepare(
    `
      UPDATE cron_job_runs
      SET status = ?, finished_at = ?, notify_sent = ?, error_text = ?
      WHERE id = ?
    `,
  ).run(
    input.status,
    input.finishedAt ?? nowIso(),
    input.notifySent === undefined ? existing.notify_sent : input.notifySent ? 1 : 0,
    input.errorText === undefined ? existing.error_text : input.errorText,
    runId,
  );

  const row = db.prepare("SELECT * FROM cron_job_runs WHERE id = ?").get(runId) as CronJobRunRow;
  return mapCronJobRun(row);
}

export function getRunningCronJobRuns(): CronJobRunRecord[] {
  const rows = db
    .prepare("SELECT * FROM cron_job_runs WHERE status = 'running' AND finished_at IS NULL ORDER BY created_at DESC, id DESC")
    .all() as CronJobRunRow[];

  return rows.map(mapCronJobRun);
}
