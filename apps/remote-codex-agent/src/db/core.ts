import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { repoRoot } from "../lib/paths";

const DEFAULT_DATABASE_PATH = "./data/app.db";

function resolveDatabasePath(): string {
  const configuredPath = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function nowIso(): string {
  return new Date().toISOString();
}

const databasePath = resolveDatabasePath();
ensureParentDirectory(databasePath);

export const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
