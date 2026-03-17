import { createServer } from "node:http";

import { createApp } from "./app";
import {
  registerRuntimeRestartHandler,
  resolveRuntimeRestartTarget,
  spawnRuntimeRestartTarget,
} from "./services/runtime/process-control";
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

async function closeRuntime(signal: string): Promise<boolean> {
  if (isShuttingDown) {
    return false;
  }

  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  }).catch(() => undefined);
  wsServer.close();
  await shutdownBackgroundServices();
  return true;
}

async function shutdown(signal: string): Promise<void> {
  const closed = await closeRuntime(signal);
  if (!closed) {
    return;
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

registerRuntimeRestartHandler(async (reason) => {
  const target = resolveRuntimeRestartTarget();
  if (!target) {
    throw new Error("Restart target is not available in the current runtime.");
  }

  const closed = await closeRuntime(reason);
  if (!closed) {
    return;
  }

  try {
    spawnRuntimeRestartTarget(target);
    process.exit(0);
  } catch (error) {
    console.error("Failed to spawn restarted runtime:", error);
    process.exit(1);
  }
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
