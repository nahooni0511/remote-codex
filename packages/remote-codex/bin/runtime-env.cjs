const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function resolveRuntimeRoot(currentDir = __dirname) {
  return path.resolve(currentDir, "..");
}

function resolveStateDir(env = process.env, homeDir = os.homedir()) {
  return env.REMOTE_CODEX_DATA_DIR?.trim() || path.join(homeDir, ".remote-codex");
}

function applyRuntimeEnvironment(options = {}) {
  const env = options.env || process.env;
  const runtimeRoot = options.runtimeRoot || resolveRuntimeRoot(options.currentDir);
  const homeDir = options.homeDir || os.homedir();
  const stateDir = resolveStateDir(env, homeDir);

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(path.join(stateDir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(stateDir, "logs"), { recursive: true });

  env.REMOTE_CODEX_HOME = env.REMOTE_CODEX_HOME?.trim() || runtimeRoot;
  env.REMOTE_CODEX_DATA_DIR = env.REMOTE_CODEX_DATA_DIR?.trim() || stateDir;
  env.DATABASE_PATH = env.DATABASE_PATH?.trim() || path.join(stateDir, "app.db");
  env.REMOTE_CODEX_WEB_DIST = env.REMOTE_CODEX_WEB_DIST?.trim() || path.join(runtimeRoot, "dist", "web");

  return {
    runtimeRoot,
    stateDir,
    databasePath: env.DATABASE_PATH,
    webDistPath: env.REMOTE_CODEX_WEB_DIST,
  };
}

module.exports = {
  applyRuntimeEnvironment,
  resolveRuntimeRoot,
  resolveStateDir,
};
