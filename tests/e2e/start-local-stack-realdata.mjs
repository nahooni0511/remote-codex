import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      entries[key] = value;
    }
  }

  return entries;
}

function resolveSourceDatabasePath() {
  const repoRoot = process.cwd();
  const envFile = parseDotEnv(path.join(repoRoot, ".env"));
  const configuredPath =
    process.env.REALDATA_SOURCE_DATABASE_PATH?.trim() || envFile.DATABASE_PATH || "./data/app.db";

  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
}

function backupDatabase(sourcePath, snapshotPath) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.rmSync(snapshotPath, { force: true });
  fs.rmSync(`${snapshotPath}-shm`, { force: true });
  fs.rmSync(`${snapshotPath}-wal`, { force: true });

  const escapedSnapshotPath = snapshotPath.replace(/'/g, "''");
  const result = spawnSync("sqlite3", [sourcePath, `.backup '${escapedSnapshotPath}'`], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`sqlite backup failed with exit code ${result.status ?? "unknown"}`);
  }
}

const snapshotPath = process.env.DATABASE_PATH;

if (!snapshotPath) {
  throw new Error("DATABASE_PATH is required for real-data e2e local stack startup.");
}

const sourcePath = resolveSourceDatabasePath();
if (!fs.existsSync(sourcePath)) {
  throw new Error(`Real-data source database does not exist: ${sourcePath}`);
}

backupDatabase(sourcePath, snapshotPath);

const child = spawn(path.join(process.cwd(), "node_modules", ".bin", "tsx"), ["apps/remote-codex-agent/src/index.ts"], {
  stdio: "inherit",
  env: process.env,
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
