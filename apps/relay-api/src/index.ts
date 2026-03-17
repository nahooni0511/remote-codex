import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import express from "express";

import { registerRelayRoutes } from "./relay/routes";
import { createRelayStore } from "./relay/store";
import { attachRelayWebSocketServer } from "./relay/ws";

function loadRelayEnv(): void {
  const candidates = [
    path.resolve(__dirname, "../.env"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    process.loadEnvFile(candidate);
  }
}

loadRelayEnv();

const PORT = Number(process.env.PORT || 3100);

function getAllowedOrigins(): string[] {
  const configured = (process.env.APP_ORIGIN || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set([...configured, "http://localhost:5173", "http://localhost:4173", "http://localhost:3000"]));
}

async function main() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  app.use((request, response, next) => {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
    if (origin && allowedOrigins.includes(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }

    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  app.use(express.json({ limit: "2mb" }));

  const relayStore = await createRelayStore({ port: PORT });
  registerRelayRoutes(app, { port: PORT, store: relayStore });

  const server = createServer(app);
  attachRelayWebSocketServer(server, relayStore);

  const shutdown = async () => {
    await relayStore.close().catch(() => undefined);
    server.close();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  server.listen(PORT, () => {
    console.log(`Relay API listening on http://localhost:${PORT}`);
  });
}

void main().catch((error) => {
  console.error("Relay API startup failed:", error);
  process.exit(1);
});
