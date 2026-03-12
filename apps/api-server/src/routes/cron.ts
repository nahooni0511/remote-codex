import { Router } from "express";

import {
  deleteCronJob as deleteCronJobRecord,
  getCronJobById,
  getThreadById,
  listCronJobs,
  listCronJobsByThread,
  updateCronJobEnabled,
} from "../db";
import { assertBoolean, HttpError, parseNumericId } from "../lib/http";
import {
  broadcastWorkspaceUpdated,
  createCronJobForThread,
  stopScheduledCronJob,
  syncCronJobSchedule,
} from "../services/runtime";

export const cronRouter = Router();

cronRouter.get("/api/cron-jobs", (_request, response, next) => {
  try {
    response.json({ jobs: listCronJobs() });
  } catch (error) {
    next(error);
  }
});

cronRouter.get("/api/threads/:threadId/cron-jobs", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    response.json({ jobs: listCronJobsByThread(threadId) });
  } catch (error) {
    next(error);
  }
});

cronRouter.post("/api/threads/:threadId/cron-jobs", (request, response, next) => {
  try {
    const threadId = parseNumericId(request.params.threadId);
    const thread = getThreadById(threadId);
    if (!thread) {
      throw new HttpError(404, "Thread not found.");
    }

    const createdJob = createCronJobForThread({
      thread,
      name: request.body.name,
      prompt: request.body.prompt,
      cronExpr: request.body.cronExpr,
      timezone: request.body.timezone,
    });

    response.status(201).json(createdJob);
  } catch (error) {
    next(error);
  }
});

cronRouter.patch("/api/cron-jobs/:jobId", (request, response, next) => {
  try {
    const jobId = parseNumericId(request.params.jobId);
    const currentJob = getCronJobById(jobId);
    if (!currentJob) {
      throw new HttpError(404, "Cron job not found.");
    }

    const enabled = assertBoolean(request.body.enabled, "Cron job enabled");
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

    response.json(syncedJob);
  } catch (error) {
    next(error);
  }
});

cronRouter.delete("/api/cron-jobs/:jobId", (request, response, next) => {
  try {
    const jobId = parseNumericId(request.params.jobId);
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

    response.status(204).end();
  } catch (error) {
    next(error);
  }
});
