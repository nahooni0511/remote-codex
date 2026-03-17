import { createServer } from "node:http";

import { createApp } from "./app";
import {
  PORT,
  attachRealtimeServer,
  prepareRuntime,
  shutdownBackgroundServices,
  startBackgroundServices,
} from "./services/runtime";

const app = createApp();
const httpServer = createServer(app);
const wsServer = attachRealtimeServer(httpServer);

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  }).catch(() => undefined);
  wsServer.close();
  await shutdownBackgroundServices();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void prepareRuntime()
  .then(
    () =>
      new Promise<void>((resolve) => {
        httpServer.listen(PORT, () => resolve());
      }),
  )
  .then(async () => {
    const url = `http://localhost:${PORT}`;
    console.log(`API server started at ${url}`);
    await startBackgroundServices();
  })
  .catch(async (error) => {
    console.error("Server startup failed:", error);
    wsServer.close();
    await shutdownBackgroundServices().catch(() => undefined);
    process.exit(1);
  });
