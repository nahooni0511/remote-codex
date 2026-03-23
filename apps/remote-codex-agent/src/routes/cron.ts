import { Router } from "express";

import {
  createThreadCronJob,
  deleteCronJob,
  listCronJobs,
  listThreadCronJobs,
  patchCronJob,
} from "../controllers/cron-controller";
import { createRouteHandler } from "../controllers/route-handler";

export const cronRouter = Router();

cronRouter.get("/api/cron-jobs", createRouteHandler(listCronJobs));
cronRouter.get("/api/threads/:threadId/cron-jobs", createRouteHandler(listThreadCronJobs));
cronRouter.post("/api/threads/:threadId/cron-jobs", createRouteHandler(createThreadCronJob));
cronRouter.patch("/api/cron-jobs/:jobId", createRouteHandler(patchCronJob));
cronRouter.delete("/api/cron-jobs/:jobId", createRouteHandler(deleteCronJob));
