import type { Express } from "express";

import { authRouter } from "./auth";
import { bootstrapRouter } from "./bootstrap";
import { cronRouter } from "./cron";
import { fsRouter } from "./fs";
import { projectsRouter } from "./projects";
import { settingsRouter } from "./settings";
import { systemRouter } from "./system";
import { threadsRouter } from "./threads";

export function registerApiRoutes(app: Express): void {
  app.use(bootstrapRouter);
  app.use(fsRouter);
  app.use(settingsRouter);
  app.use(systemRouter);
  app.use(authRouter);
  app.use(projectsRouter);
  app.use(threadsRouter);
  app.use(cronRouter);
}
