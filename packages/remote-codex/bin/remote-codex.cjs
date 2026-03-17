#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const runtimeRoot = path.resolve(__dirname, "..");
const stateDir = process.env.REMOTE_CODEX_DATA_DIR?.trim() || path.join(os.homedir(), ".remote-codex");

fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(path.join(stateDir, "artifacts"), { recursive: true });

process.env.REMOTE_CODEX_HOME = process.env.REMOTE_CODEX_HOME?.trim() || runtimeRoot;
process.env.REMOTE_CODEX_DATA_DIR = process.env.REMOTE_CODEX_DATA_DIR?.trim() || stateDir;
process.env.DATABASE_PATH = process.env.DATABASE_PATH?.trim() || path.join(stateDir, "app.db");
process.env.REMOTE_CODEX_WEB_DIST =
  process.env.REMOTE_CODEX_WEB_DIST?.trim() || path.join(runtimeRoot, "dist", "web");

require(path.join(runtimeRoot, "dist", "agent", "index.js"));
