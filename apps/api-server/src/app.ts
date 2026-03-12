import express from "express";

import { corsMiddleware } from "./lib/cors";
import { errorHandler } from "./lib/error-handler";
import { registerApiRoutes } from "./routes";

export function createApp() {
  const app = express();

  app.use(corsMiddleware);
  app.use(express.json());
  registerApiRoutes(app);
  app.use(errorHandler);

  return app;
}
