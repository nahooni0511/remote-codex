import fs from "node:fs";
import path from "node:path";

import express from "express";

import { corsMiddleware } from "./lib/cors";
import { errorHandler } from "./lib/error-handler";
import { resolveFromRepo } from "./lib/paths";
import { registerApiRoutes } from "./routes";

export function createApp() {
  const app = express();
  const webDistPath = process.env.REMOTE_CODEX_WEB_DIST?.trim() || resolveFromRepo("apps/remote-codex-web/dist");
  const indexHtmlPath = path.join(webDistPath, "index.html");

  app.use(corsMiddleware);
  app.use(express.json({ limit: "25mb" }));
  registerApiRoutes(app);

  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(webDistPath));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api")) {
        next();
        return;
      }

      response.sendFile(indexHtmlPath);
    });
  }

  app.use(errorHandler);

  return app;
}
