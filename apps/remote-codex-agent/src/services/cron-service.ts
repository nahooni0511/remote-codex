import {
  deleteCronJob as deleteCronJobRecord,
  getCronJobById,
  getThreadById,
  listCronJobs,
  listCronJobsByThread,
  updateCronJobEnabled,
} from "../db";
import { HttpError } from "../lib/http";
import {
  broadcastWorkspaceUpdated,
  createCronJobForThread,
  stopScheduledCronJob,
  syncCronJobSchedule,
} from "./runtime";

export function listWorkspaceCronJobs() {
  return listCronJobs();
}

export function listWorkspaceThreadCronJobs(threadId: number) {
  const thread = getThreadById(threadId);
  if (!thread) {
    throw new HttpError(404, "Thread not found.");
  }

  return listCronJobsByThread(threadId);
}

export function createWorkspaceCronJob(input: {
  threadId: number;
  name: string;
  prompt: string;
  cronExpr: string;
  timezone: string;
}) {
  const thread = getThreadById(input.threadId);
  if (!thread) {
    throw new HttpError(404, "Thread not found.");
  }

  return createCronJobForThread({
    thread,
    name: input.name,
    prompt: input.prompt,
    cronExpr: input.cronExpr,
    timezone: input.timezone,
  });
}

export function updateWorkspaceCronJobEnabled(jobId: number, enabled: boolean) {
  const currentJob = getCronJobById(jobId);
  if (!currentJob) {
    throw new HttpError(404, "Cron job not found.");
  }

  const updatedJob = updateCronJobEnabled(jobId, enabled);
  if (!updatedJob) {
    throw new HttpError(404, "Cron job not found.");
  }

  const syncedJob = syncCronJobSchedule(updatedJob);
  const thread = getThreadById(currentJob.threadId);
  broadcastWorkspaceUpdated({
    projectId: thread?.projectId ?? null,
    threadId: currentJob.threadId,
  });

  return syncedJob;
}

export function deleteWorkspaceCronJob(jobId: number) {
  const job = getCronJobById(jobId);
  if (!job) {
    throw new HttpError(404, "Cron job not found.");
  }

  const thread = getThreadById(job.threadId);
  stopScheduledCronJob(jobId);
  if (!deleteCronJobRecord(jobId)) {
    throw new HttpError(404, "Cron job not found.");
  }

  broadcastWorkspaceUpdated({
    projectId: thread?.projectId ?? null,
    threadId: job.threadId,
  });
}
