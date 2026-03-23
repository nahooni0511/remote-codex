import type { Request, Response } from "express";

import { assertBoolean, parseNumericId } from "../lib/http";
import {
  createWorkspaceCronJob,
  deleteWorkspaceCronJob,
  listWorkspaceCronJobs,
  listWorkspaceThreadCronJobs,
  updateWorkspaceCronJobEnabled,
} from "../services/cron-service";

function getParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] || "" : value;
}

export function listCronJobs(_request: Request, response: Response) {
  response.json({ jobs: listWorkspaceCronJobs() });
}

export function listThreadCronJobs(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  response.json({ jobs: listWorkspaceThreadCronJobs(threadId) });
}

export function createThreadCronJob(request: Request, response: Response) {
  const threadId = parseNumericId(getParam(request.params.threadId));
  const createdJob = createWorkspaceCronJob({
    threadId,
    name: request.body.name,
    prompt: request.body.prompt,
    cronExpr: request.body.cronExpr,
    timezone: request.body.timezone,
  });

  response.status(201).json(createdJob);
}

export function patchCronJob(request: Request, response: Response) {
  const jobId = parseNumericId(getParam(request.params.jobId));
  const enabled = assertBoolean(request.body.enabled, "Cron job enabled");
  response.json(updateWorkspaceCronJobEnabled(jobId, enabled));
}

export function deleteCronJob(request: Request, response: Response) {
  const jobId = parseNumericId(getParam(request.params.jobId));
  deleteWorkspaceCronJob(jobId);
  response.status(204).end();
}
