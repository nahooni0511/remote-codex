#!/usr/bin/env node

const WebSocket = require("ws");

const url = process.argv[2] || process.env.WS_URL || "ws://localhost:3000/ws";
const timeoutMs = Number(process.env.WS_SMOKE_TIMEOUT_MS || 5000);

let settled = false;

function formatError(error) {
  if (!error || typeof error !== "object") {
    return String(error || "Unknown error");
  }

  const parts = [];
  if (error.code) {
    parts.push(String(error.code));
  }
  if (error.message) {
    parts.push(String(error.message));
  }

  return parts.join(": ") || JSON.stringify(error);
}

function finish(code, message) {
  if (settled) {
    return;
  }

  settled = true;
  if (message) {
    if (code === 0) {
      console.log(message);
    } else {
      console.error(message);
    }
  }
  process.exit(code);
}

const socket = new WebSocket(url);

const timeout = setTimeout(() => {
  try {
    socket.terminate();
  } catch {}
  finish(1, `WS smoke test timed out after ${timeoutMs}ms: ${url}`);
}, timeoutMs);

socket.on("open", () => {
  console.log(`WS connected: ${url}`);
});

socket.on("message", (data) => {
  clearTimeout(timeout);

  let parsed;
  try {
    parsed = JSON.parse(String(data));
  } catch (error) {
    try {
      socket.close();
    } catch {}
    finish(1, `WS smoke test received non-JSON payload: ${String(data)}`);
    return;
  }

  try {
    socket.close();
  } catch {}

  if (!parsed || parsed.type !== "connected") {
    finish(1, `WS smoke test received unexpected event: ${JSON.stringify(parsed)}`);
    return;
  }

  finish(0, `WS smoke test passed: ${JSON.stringify(parsed)}`);
});

socket.on("error", (error) => {
  clearTimeout(timeout);
  finish(1, `WS smoke test failed: ${formatError(error)}`);
});

socket.on("close", () => {
  clearTimeout(timeout);
  if (!settled) {
    finish(1, "WS smoke test failed: socket closed before a valid event was received.");
  }
});
